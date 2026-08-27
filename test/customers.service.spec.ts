import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from '../src/customers/customers.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditLogService } from '../src/audit-log/audit-log.service';

// getStats() chạy 3 raw query (rows / count / tổng closed_value toàn hệ thống) rồi 2 query
// findMany phụ để join tên tỉnh/phường — mock Prisma bằng plain object jest.fn(), KHÔNG đụng DB thật.
describe('CustomersService.getStats', () => {
  let service: CustomersService;
  let prisma: any;
  let auditLog: any;

  const CUSTOMER_ROW = {
    id: 'cust1',
    name: 'Nguyễn Văn A',
    phone: '0900000000',
    address: '123 Đường ABC',
    provinceId: 'prov1',
    wardId: 'ward1',
    total_orders: 5,
    total_closed: 3,
    closed_value: '50000000',
    last_order: new Date('2026-08-20T00:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([CUSTOMER_ROW])
        .mockResolvedValueOnce([{ count: 1n }])
        .mockResolvedValueOnce([{ sum: '50000000' }]),
      province: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'prov1', name: 'Hà Nội' }]),
      },
      ward: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'ward1', name: 'Phường 1' }]),
      },
    };

    auditLog = { logAction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  it('returns paginated stats with numeric closedValue/total coercion', async () => {
    const result = await service.getStats({ page: 1, limit: 12 } as any);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].customer.id).toBe('cust1');
    expect(result.data[0].totalOrders).toBe(5);
    expect(result.data[0].totalClosed).toBe(3);
    expect(result.data[0].closedValue).toBe(50_000_000);
    expect(typeof result.data[0].closedValue).toBe('number');

    expect(result.meta.total).toBe(1);
    expect(result.meta.totalPages).toBe(1);

    expect(result.totalClosedValueAll).toBe(50_000_000);
    expect(typeof result.totalClosedValueAll).toBe('number');
  });

  it('joins province/ward names onto the customer row', async () => {
    const result = await service.getStats({ page: 1, limit: 12 } as any);

    expect(result.data[0].customer.province).toEqual({
      id: 'prov1',
      name: 'Hà Nội',
    });
    expect(result.data[0].customer.ward).toEqual({
      id: 'ward1',
      name: 'Phường 1',
    });
  });
});
