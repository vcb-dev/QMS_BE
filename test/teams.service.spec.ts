import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TeamsService } from '../src/teams/teams.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Mock Prisma bằng plain object jest.fn(), KHÔNG đụng DB thật.
describe('TeamsService', () => {
  let service: TeamsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      team: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'Team A' }),
        create: jest
          .fn()
          .mockImplementation(({ data }) => ({ id: 'new', ...data })),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) => ({ id: where.id, ...data })),
        delete: jest.fn().mockImplementation(({ where }) => ({ id: where.id })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TeamsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TeamsService);
  });

  describe('findAll', () => {
    it('sắp theo tên tăng dần, không có search thì không lọc', async () => {
      await service.findAll();
      expect(prisma.team.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { name: 'asc' },
      });
    });

    it('có search → contains không phân biệt hoa thường', async () => {
      await service.findAll('ab');
      expect(prisma.team.findMany).toHaveBeenCalledWith({
        where: { name: { contains: 'ab', mode: 'insensitive' } },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('findPaginated', () => {
    it('trả totalPages = ceil(total/limit), kèm _count.users', async () => {
      prisma.team.count.mockResolvedValue(25);
      prisma.team.findMany.mockResolvedValue([{ id: 't1' }]);

      const res = await service.findPaginated(2, 10);

      expect(res.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
      expect(res.data).toEqual([{ id: 't1' }]);
      expect(prisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          orderBy: { name: 'asc' },
          include: { _count: { select: { users: true } } },
        }),
      );
    });
  });

  describe('create', () => {
    it('cắt khoảng trắng đầu/cuối rồi mới lưu', async () => {
      await service.create('  Team A ');
      expect(prisma.team.create).toHaveBeenCalledWith({
        data: { name: 'Team A' },
      });
    });

    it('so khớp trùng tên không phân biệt hoa thường trên tên đã cắt', async () => {
      await service.create(' team a ');
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: 'team a', mode: 'insensitive' } },
        select: { id: true },
      });
    });

    it('trùng tên → 409 "Team đã tồn tại" và KHÔNG gọi create', async () => {
      prisma.team.findFirst.mockResolvedValue({ id: 'other' });
      await expect(service.create('Team A')).rejects.toThrow(
        new ConflictException('Team đã tồn tại'),
      );
      expect(prisma.team.create).not.toHaveBeenCalled();
    });

    it('tên chỉ có khoảng trắng → 400 và không ghi', async () => {
      await expect(service.create('   ')).rejects.toThrow('Tên team');
      expect(prisma.team.create).not.toHaveBeenCalled();
    });

    it('tranh chấp ghi đồng thời (P2002 từ unique index) → 409', async () => {
      const err: any = new Error('Unique constraint failed');
      err.code = 'P2002';
      prisma.team.create.mockRejectedValue(err);
      await expect(service.create('Team A')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('team không tồn tại → 404 "Team không tồn tại", không ghi', async () => {
      prisma.team.findUnique.mockResolvedValue(null);
      await expect(service.update('nope', 'X')).rejects.toThrow(
        new NotFoundException('Team không tồn tại'),
      );
      expect(prisma.team.update).not.toHaveBeenCalled();
    });

    it('đổi sang tên của team KHÁC → 409; truy vấn trùng loại trừ id hiện tại', async () => {
      prisma.team.findFirst.mockResolvedValue({ id: 'other' });
      await expect(service.update('t1', 'Team B')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: {
          name: { equals: 'Team B', mode: 'insensitive' },
          NOT: { id: 't1' },
        },
        select: { id: true },
      });
      expect(prisma.team.update).not.toHaveBeenCalled();
    });

    it('đổi giữ nguyên tên của chính nó (chỉ khác hoa/thường) → thành công', async () => {
      // Không có team KHÁC trùng tên (findFirst đã loại trừ id hiện tại)
      prisma.team.findFirst.mockResolvedValue(null);
      const res = await service.update('t1', ' team a ');
      expect(prisma.team.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { name: 'team a' },
      });
      expect(res).toEqual({ id: 't1', name: 'team a' });
    });
  });

  describe('remove', () => {
    it('team không tồn tại → 404, không xóa', async () => {
      prisma.team.findUnique.mockResolvedValue(null);
      await expect(service.remove('nope')).rejects.toThrow(
        new NotFoundException('Team không tồn tại'),
      );
      expect(prisma.team.delete).not.toHaveBeenCalled();
    });

    it('team đang có thành viên vẫn xóa (FK SET NULL, không chặn)', async () => {
      prisma.team.findUnique.mockResolvedValue({
        id: 't1',
        name: 'Team A',
        _count: { users: 5 },
      });
      await service.remove('t1');
      expect(prisma.team.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });
});
