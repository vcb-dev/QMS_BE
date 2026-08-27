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
          ])
          .mockResolvedValueOnce([{ departmentId: 'd1', _count: { _all: 5 } }]),
      },
      department: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'd1', name: 'Kinh doanh' }]),
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
    expect(result.byDept).toEqual([{ name: 'Kinh doanh', count: 5 }]);
    expect(result.pendingCount).toBe(2);
  });
});
