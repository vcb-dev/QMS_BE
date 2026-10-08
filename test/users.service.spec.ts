import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../src/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditLogService } from '../src/audit-log/audit-log.service';

describe('UsersService.getStats', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        count: jest
          .fn()
          .mockResolvedValueOnce(10) // total
          .mockResolvedValueOnce(2), // pendingCount
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([
            { role: 'SALE', _count: { _all: 5 } },
            { role: 'ORDER', _count: { _all: 3 } },
            { role: 'ADMIN', _count: { _all: 2 } },
          ]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { logAction: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('trả đúng byRole/byDept/pendingCount', async () => {
    const result = await service.getStats();
    expect(result.totalUsers).toBe(10);
    expect(result.byRole).toEqual({ SALE: 5, ORDER: 3, ADMIN: 2 });
    expect(result.byDept).toEqual([]);
    expect(result.pendingCount).toBe(2);
  });
});

describe('UsersService — team (duyệt tài khoản / đổi team)', () => {
  let service: UsersService;
  let prisma: any;
  let auditLog: any;

  const TEAM = { id: 't1' };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1' }),
        update: jest.fn().mockImplementation(({ where, data }) => ({
          id: where.id,
          ...data,
          team: data.teamId ? { id: data.teamId, name: 'Team A' } : null,
        })),
      },
      team: { findUnique: jest.fn().mockResolvedValue(TEAM) },
    };
    auditLog = { logAction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  describe('approveUser', () => {
    it('teamId hợp lệ → ghi isApproved + teamId trong MỘT lần update', async () => {
      await service.approveUser('u1', 'admin1', Role.ADMIN, Role.SALE, 't1');

      expect(prisma.team.findUnique).toHaveBeenCalledWith({
        where: { id: 't1' },
        select: { id: true },
      });
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          isApproved: true,
          teamId: 't1',
          role: Role.SALE,
        }),
      );
    });

    it('team không tồn tại → 404 "Team không tồn tại" và KHÔNG duyệt (không update)', async () => {
      prisma.team.findUnique.mockResolvedValue(null);

      await expect(
        service.approveUser('u1', 'admin1', Role.ADMIN, Role.SALE, 'ghost'),
      ).rejects.toThrow(new NotFoundException('Team không tồn tại'));
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditLog.logAction).not.toHaveBeenCalled();
    });

    it('không truyền teamId → data không có khóa teamId và không tra team', async () => {
      await service.approveUser('u1', 'admin1', Role.ADMIN, Role.SALE);

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('teamId');
      expect(data.isApproved).toBe(true);
      expect(prisma.team.findUnique).not.toHaveBeenCalled();
    });

    it.each([null, ''])(
      'teamId = %p → duyệt và để trống team (teamId null)',
      async (teamId) => {
        await service.approveUser(
          'u1',
          'admin1',
          Role.ADMIN,
          undefined,
          teamId,
        );

        const data = prisma.user.update.mock.calls[0][0].data;
        expect(data).toEqual({ isApproved: true, teamId: null });
        expect(prisma.team.findUnique).not.toHaveBeenCalled();
      },
    );

    it('teamId sai kiểu → 400 và không update', async () => {
      await expect(
        service.approveUser('u1', 'admin1', Role.ADMIN, undefined, 123 as any),
      ).rejects.toThrow(new BadRequestException('teamId không hợp lệ'));
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('người dùng không tồn tại → 404 và không tra team', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.approveUser('nope', 'admin1', Role.ADMIN, undefined, 't1'),
      ).rejects.toThrow(new NotFoundException('Không tìm thấy người dùng'));
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('setUserTeam', () => {
    it('gán team → update { teamId } + audit SET_USER_TEAM, trả user kèm team', async () => {
      const res = await service.setUserTeam('u1', 't1', 'admin1', Role.ADMIN);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { teamId: 't1' },
        }),
      );
      expect(auditLog.logAction).toHaveBeenCalledWith(
        'admin1',
        Role.ADMIN,
        'SET_USER_TEAM',
        'User',
        'u1',
      );
      expect(res.team).toEqual({ id: 't1', name: 'Team A' });
    });

    it('teamId = null → gỡ team ({ teamId: null }), không tra team', async () => {
      await service.setUserTeam('u1', null, 'admin1', Role.ADMIN);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { teamId: null } }),
      );
      expect(prisma.team.findUnique).not.toHaveBeenCalled();
    });

    it('người dùng không tồn tại → 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setUserTeam('nope', 't1', 'admin1', Role.ADMIN),
      ).rejects.toThrow(new NotFoundException('Không tìm thấy người dùng'));
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('team không tồn tại → 404 "Team không tồn tại", không ghi, không audit', async () => {
      prisma.team.findUnique.mockResolvedValue(null);
      await expect(
        service.setUserTeam('u1', 'ghost', 'admin1', Role.ADMIN),
      ).rejects.toThrow(new NotFoundException('Team không tồn tại'));
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditLog.logAction).not.toHaveBeenCalled();
    });

    it.each([123, undefined, {}])(
      'teamId = %p → 400 "teamId không hợp lệ"',
      async (teamId) => {
        await expect(
          service.setUserTeam('u1', teamId as any, 'admin1', Role.ADMIN),
        ).rejects.toThrow(new BadRequestException('teamId không hợp lệ'));
        expect(prisma.user.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('dữ liệu trả về có team', () => {
    it('findAll / findPending / findOne chọn thêm team { id, name }', async () => {
      prisma.user.findMany = jest.fn().mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

      await service.findAll();
      await service.findPending();
      await service.findOne('u1');

      const selects = [
        prisma.user.findMany.mock.calls[0][0].select,
        prisma.user.findMany.mock.calls[1][0].select,
        prisma.user.findUnique.mock.calls[0][0].select,
      ];
      for (const select of selects) {
        expect(select.team).toEqual({ select: { id: true, name: true } });
      }
    });
  });
});
