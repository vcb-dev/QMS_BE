import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CustomerStatsQueryDto } from '../src/customers/dto/customer-stats-query.dto';
import { CustomersService } from '../src/customers/customers.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditLogService } from '../src/audit-log/audit-log.service';

// getStats() chạy 2 raw query (rows / count) rồi 2 query
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
    last_order: new Date('2026-08-20T00:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([CUSTOMER_ROW])
        .mockResolvedValueOnce([{ count: 1n }]),
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

  it('returns paginated stats without any closed-value fields', async () => {
    const result = await service.getStats({ page: 1, limit: 12 } as any);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].customer.id).toBe('cust1');
    expect(result.data[0].totalOrders).toBe(5);
    expect(result.data[0].lastOrder).toEqual(new Date('2026-08-20T00:00:00Z'));
    expect(result.data[0]).not.toHaveProperty('totalClosed');
    expect(result.data[0]).not.toHaveProperty('closedValue');

    expect(result.meta.total).toBe(1);
    expect(result.meta.totalPages).toBe(1);
    expect(result).not.toHaveProperty('totalClosedValueAll');
  });

  it('SQL không còn cột closed_value và mặc định sắp theo số đơn', async () => {
    await service.getStats({ page: 1, limit: 12 } as any);

    const sqlText: string = prisma.$queryRaw.mock.calls[0][0].sql;
    expect(sqlText).not.toContain('closed_value');
    expect(sqlText).not.toContain('CLOSED');
    expect(sqlText).toContain('ORDER BY total_orders DESC');
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

describe('CustomersService.getMonthComparison', () => {
  let service: CustomersService;
  let prisma: any;

  beforeEach(async () => {
    // Mỗi kỳ (tháng này / tháng trước) chạy 1 raw query đếm số khách hoạt động.
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ customer_count: 3n }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { logAction: jest.fn() } },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  it('chỉ trả số khách hoạt động, không còn closedValue', async () => {
    const result = await service.getMonthComparison();

    expect(result).toEqual({
      current: { customerCount: 3 },
      previous: { customerCount: 3 },
      customerCountDeltaPct: 0,
    });
  });
});

describe('CustomerStatsQueryDto', () => {
  const invalidFields = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(CustomerStatsQueryDto, plain)).map(
      (e) => e.property,
    );

  it('từ chối sortMode=TOP_SPEND (chế độ sắp theo giá trị đã chốt đã gỡ)', () => {
    expect(invalidFields({ sortMode: 'TOP_SPEND' })).toContain('sortMode');
  });

  it.each(['MOST_ORDERS', 'RECENT'])('chấp nhận sortMode=%s', (mode) => {
    expect(invalidFields({ sortMode: mode })).not.toContain('sortMode');
  });

  it('mặc định sortMode là MOST_ORDERS', () => {
    expect(plainToInstance(CustomerStatsQueryDto, {}).sortMode).toBe(
      'MOST_ORDERS',
    );
  });
});
