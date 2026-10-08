import { Test, TestingModule } from '@nestjs/testing';
import { QuoteAnalyticsService } from '../src/quote-requests/quote/quote-analytics.service';
import { PrismaService } from '../src/prisma/prisma.service';

// getDashboardCharts() gọi 4 query song song (findMany timeline, groupBy sale, groupBy category,
// findMany price/material trong kỳ) + 1 query finalOptionId mọi thời kỳ cho featuredProducts, rồi
// thêm các query phụ (user/category/material/option lookup) — mock Prisma bằng plain object
// jest.fn(), KHÔNG đụng DB thật.
describe('QuoteAnalyticsService.getDashboardCharts', () => {
  let service: QuoteAnalyticsService;
  let prisma: any;

  const TIMELINE_ROWS = [
    { createdAt: new Date('2026-08-05T10:00:00Z'), status: 'CLOSED' },
    { createdAt: new Date('2026-08-06T10:00:00Z'), status: 'PENDING' },
  ];

  const PRICE_STAT_ROWS = [
    { finalOptionId: 'o1', finalPrice: 6_000_000 },
    { finalOptionId: 'o2', finalPrice: 20_000_000 },
    { finalOptionId: null, finalPrice: null },
  ];

  const SALE_GROUPS = [
    { requesterId: 'u1', status: 'CLOSED', _count: { _all: 3 } },
    { requesterId: 'u1', status: 'PENDING', _count: { _all: 1 } },
    { requesterId: 'u2', status: 'CLOSED', _count: { _all: 1 } },
  ];

  const CATEGORY_GROUPS = [
    { categoryId: 'c1', _count: { _all: 5 } },
    { categoryId: 'c2', _count: { _all: 2 } },
  ];

  const SALE_USERS = [
    { id: 'u1', name: 'Sale A' },
    { id: 'u2', name: 'Sale B' },
  ];

  const CATEGORIES = [
    { id: 'c1', name: 'Nhẫn' },
    { id: 'c2', name: 'Dây chuyền' },
  ];

  const OPTION_MATERIALS = [
    { optionId: 'o1', material: { name: 'Vàng 18K' } },
    { optionId: 'o2', material: { name: 'Vàng 24K' } },
  ];

  const FEATURED_OPTIONS = [
    {
      id: 'o2',
      quotedPrice: 20_000_000,
      stonePrice: 3_000_000,
      quoteRequest: {
        id: 'r2',
        productName: 'Dây chuyền Rồng Vàng',
        images: [{ id: 'img1', imageUrl: 'https://example.com/a.png' }],
      },
    },
    {
      id: 'o1',
      quotedPrice: 6_000_000,
      stonePrice: null,
      quoteRequest: {
        id: 'r1',
        productName: 'Nhẫn Cưới Ánh Dương',
        images: [],
      },
    },
  ];

  beforeEach(async () => {
    prisma = {
      quoteRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(TIMELINE_ROWS)
          .mockResolvedValueOnce(PRICE_STAT_ROWS)
          // featuredProducts lấy finalOptionId MỌI THỜI KỲ (query riêng, bỏ filter ngày)
          .mockResolvedValueOnce(PRICE_STAT_ROWS),
        groupBy: jest
          .fn()
          .mockResolvedValueOnce(SALE_GROUPS)
          .mockResolvedValueOnce(CATEGORY_GROUPS),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(SALE_USERS),
      },
      productCategory: {
        findMany: jest.fn().mockResolvedValue(CATEGORIES),
      },
      quoteOptionMaterial: {
        findMany: jest.fn().mockResolvedValue(OPTION_MATERIALS),
      },
      quoteOption: {
        findMany: jest.fn().mockResolvedValue(FEATURED_OPTIONS),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteAnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(QuoteAnalyticsService);
  });

  it('returns all 6 chart keys', async () => {
    const result = await service.getDashboardCharts(
      { timeRange: 'THIS_MONTH' } as any,
      { id: 'u1', role: 'ADMIN' } as any,
    );

    expect(result).toHaveProperty('timeline');
    expect(result).toHaveProperty('saleStats');
    expect(result).toHaveProperty('categoryDistribution');
    expect(result).toHaveProperty('materialDistribution');
    expect(result).toHaveProperty('priceRangeDistribution');
    expect(result).toHaveProperty('featuredProducts');
  });

  it('joins saleStats names/totals from the mocked user lookup, sorted by total desc', async () => {
    const result = await service.getDashboardCharts(
      { timeRange: 'THIS_MONTH' } as any,
      { id: 'u1', role: 'ADMIN' } as any,
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2'] } },
      select: { id: true, name: true },
    });
    expect(result.saleStats).toEqual([
      { id: 'u1', name: 'Sale A', total: 4, closed: 3 },
      { id: 'u2', name: 'Sale B', total: 1, closed: 1 },
    ]);
  });

  it('joins categoryDistribution names from the mocked category lookup, sorted by value desc', async () => {
    const result = await service.getDashboardCharts(
      { timeRange: 'THIS_MONTH' } as any,
      { id: 'u1', role: 'ADMIN' } as any,
    );

    expect(prisma.productCategory.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] } },
      select: { id: true, name: true },
    });
    expect(result.categoryDistribution).toEqual([
      { name: 'Nhẫn', value: 5 },
      { name: 'Dây chuyền', value: 2 },
    ]);
  });

  it('buckets priceRangeDistribution from the mocked finalPrice values', async () => {
    const result = await service.getDashboardCharts(
      { timeRange: 'THIS_MONTH' } as any,
      { id: 'u1', role: 'ADMIN' } as any,
    );

    // PRICE_STAT_ROWS: 6tr -> '5-15tr', 20tr -> '15-30tr', null bị bỏ qua (giá 0 không đếm)
    expect(result.priceRangeDistribution).toEqual([
      { label: '< 5tr', value: 0 },
      { label: '5-15tr', value: 1 },
      { label: '15-30tr', value: 1 },
      { label: '> 30tr', value: 0 },
    ]);
  });

  it('builds materialDistribution and featuredProducts from finalOptionId (not "latest option")', async () => {
    const result = await service.getDashboardCharts(
      { timeRange: 'THIS_MONTH' } as any,
      { id: 'u1', role: 'ADMIN' } as any,
    );

    expect(prisma.quoteOptionMaterial.findMany).toHaveBeenCalledWith({
      where: { optionId: { in: ['o1', 'o2'] } },
      select: { optionId: true, material: { select: { name: true } } },
    });
    expect(result.materialDistribution).toEqual(
      expect.arrayContaining([
        { name: 'Vàng 18K', value: 1 },
        { name: 'Vàng 24K', value: 1 },
      ]),
    );

    expect(result.featuredProducts).toHaveLength(2);
    expect(result.featuredProducts[0]).toEqual({
      key: 'r2:o2',
      productName: 'Dây chuyền Rồng Vàng',
      price: 20_000_000,
      materialPrice: 17_000_000,
      stonePrice: 3_000_000,
      images: [{ id: 'img1', imageUrl: 'https://example.com/a.png' }],
    });
  });
});

describe('QuoteAnalyticsService.getStaffPerformance', () => {
  let service: QuoteAnalyticsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      quoteRequest: {
        groupBy: jest.fn().mockResolvedValue([
          { requesterId: 'sale-1', status: 'CLOSED', _count: { _all: 2 } },
          { requesterId: 'sale-1', status: 'QUOTED', _count: { _all: 1 } },
        ]),
        findMany: jest.fn().mockResolvedValue([
          {
            assigneeId: 'order-1',
            acceptedAt: new Date('2026-01-01T00:00:00Z'),
            returnedAt: null,
            status: 'CLOSED',
            updatedAt: new Date('2026-01-02T00:00:00Z'),
            finalOptionId: 'o1',
          },
        ]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'sale-1', name: 'Sale A' }])
          .mockResolvedValueOnce([{ id: 'order-1', name: 'Order A' }]),
      },
      quoteOption: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'o1', quotedDate: new Date('2026-01-01T05:00:00Z') },
          ]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteAnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<QuoteAnalyticsService>(QuoteAnalyticsService);
  });

  it('saleStats gồm cả sale không có đơn nào (total=0)', async () => {
    prisma.user.findMany = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 'sale-1', name: 'Sale A' },
        { id: 'sale-2', name: 'Sale B' },
      ])
      .mockResolvedValueOnce([]);
    const result = await service.getStaffPerformance();
    expect(result.saleStats.items).toEqual(
      expect.arrayContaining([
        {
          id: 'sale-1',
          name: 'Sale A',
          total: 3,
          closed: 2,
          closeRate: (2 / 3) * 100,
        },
        { id: 'sale-2', name: 'Sale B', total: 0, closed: 0, closeRate: 0 },
      ]),
    );
  });

  it('pricerStats: totalHandled và medianProcessMs vẫn tính từ lúc tiếp nhận (còn trả về để tương thích)', async () => {
    const result = await service.getStaffPerformance();
    const pricer = result.pricerStats.items.find((p) => p.id === 'order-1');
    expect(pricer?.totalHandled).toBe(1);
    expect(pricer?.medianProcessMs).toBe(5 * 60 * 60 * 1000); // 5 giờ
    // medianQuoteMs không còn tính từ lúc tiếp nhận — xem describe "thời gian báo giá tính từ lúc giao đơn"
    expect(pricer?.medianQuoteMs).toBeNull();
  });
});

describe('QuoteAnalyticsService.getStaffPerformance — số đơn được giao / số đơn báo giá', () => {
  const T0 = new Date('2026-01-01T00:00:00Z');
  let service: QuoteAnalyticsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      quoteRequest: {
        // groupBy được gọi 2 kiểu: theo requesterId (bảng Sale) và theo assignedOrderId (số đơn được giao)
        groupBy: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(
            args.by.includes('assignedOrderId')
              ? [
                  { assignedOrderId: 'order-1', _count: { _all: 4 } },
                  { assignedOrderId: 'order-2', _count: { _all: 1 } },
                ]
              : [],
          ),
        ),
        findMany: jest.fn().mockResolvedValue([
          // order-1: 2 đơn đã báo giá (o1 đúng chiều, o2 ngày báo giá TRƯỚC lúc nhận — dữ liệu lệch), 1 đơn bị từ chối
          { assigneeId: 'order-1', acceptedAt: T0, returnedAt: null, status: 'QUOTED', updatedAt: T0, finalOptionId: 'o1' },
          { assigneeId: 'order-1', acceptedAt: T0, returnedAt: null, status: 'CLOSED', updatedAt: T0, finalOptionId: 'o2' },
          { assigneeId: 'order-1', acceptedAt: T0, returnedAt: null, status: 'REJECTED', updatedAt: T0, finalOptionId: null },
          // order-2: nhận rồi trả lại Sale, chưa báo giá lần nào
          { assigneeId: 'order-2', acceptedAt: T0, returnedAt: new Date('2026-01-01T02:00:00Z'), status: 'NEED_MORE_INFO', updatedAt: T0, finalOptionId: null },
        ]),
      },
      user: {
        // gọi nhiều lần được (mỗi test có thể gọi getStaffPerformance 2 lần) nên trả theo role, không dùng Once
        findMany: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(
            args.where.role === 'ORDER'
              ? [
                  { id: 'order-1', name: 'Order A' },
                  { id: 'order-2', name: 'Order B' },
                  { id: 'order-3', name: 'Order C' },
                ]
              : [],
          ),
        ),
      },
      quoteOption: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'o1', quotedDate: new Date('2026-01-01T05:00:00Z') },
          { id: 'o2', quotedDate: new Date('2025-12-31T23:00:00Z') },
        ]),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteAnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(QuoteAnalyticsService);
  });

  const find = (res: any, id: string) =>
    res.pricerStats.items.find((p: any) => p.id === id);

  it('assignedCount = số đơn được hệ thống giao cho Order đó; Order không được giao đơn nào = 0', async () => {
    const res = await service.getStaffPerformance();
    expect(find(res, 'order-1').assignedCount).toBe(4);
    expect(find(res, 'order-2').assignedCount).toBe(1);
    expect(find(res, 'order-3').assignedCount).toBe(0);
  });

  it('quotedCount = số đơn Order đó đã báo giá (có ngày báo giá), không tính đơn từ chối/trả lại', async () => {
    const res = await service.getStaffPerformance();
    expect(find(res, 'order-1').quotedCount).toBe(2);
    expect(find(res, 'order-2').quotedCount).toBe(0);
    expect(find(res, 'order-3').quotedCount).toBe(0);
  });

  it('đơn có ngày báo giá lệch (trước lúc nhận) vẫn tính vào quotedCount', async () => {
    const res = await service.getStaffPerformance();
    // o1 đúng chiều, o2 ngày báo giá trước lúc nhận (âm) — cả hai đều là đơn đã báo giá
    expect(find(res, 'order-1').quotedCount).toBe(2);
  });

  it('đếm đơn được giao chỉ trong kỳ đang lọc (theo ngày tạo đơn)', async () => {
    await service.getStaffPerformance({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    } as any);
    const call = prisma.quoteRequest.groupBy.mock.calls
      .map(([a]: any[]) => a)
      .find((a: any) => a.by.includes('assignedOrderId'));
    expect(call.where.createdAt).toBeDefined();
    expect(call.where.assignedOrderId).toEqual({ not: null });
  });

  it('sắp xếp theo assignedCount / quotedCount giảm dần', async () => {
    const byAssigned = await service.getStaffPerformance({
      pricerSortField: 'assignedCount',
      pricerSortDir: 'desc',
    } as any);
    expect(byAssigned.pricerStats.items.map((p: any) => p.id)).toEqual([
      'order-1',
      'order-2',
      'order-3',
    ]);
    const byQuoted = await service.getStaffPerformance({
      pricerSortField: 'quotedCount',
      pricerSortDir: 'desc',
    } as any);
    expect(byQuoted.pricerStats.items[0].id).toBe('order-1');
  });
});

describe('QuoteAnalyticsService.getStaffPerformance — thời gian báo giá tính từ lúc giao đơn', () => {
  const MIN = 60 * 1000;
  const at = (hhmm: string) => new Date(`2026-01-01T${hhmm}:00Z`);

  type Assigned = {
    id: string;
    assignedOrderId: string;
    createdAt: Date;
    finalOptionId: string | null;
  };
  type Audit = { entityId: string; action: string; createdAt: Date };

  async function setup(opts: {
    assigned: Assigned[];
    options: { id: string; quotedDate: Date | null }[];
    audit?: Audit[];
    pricerRows?: any[];
  }) {
    const prisma: any = {
      quoteRequest: {
        groupBy: jest.fn().mockResolvedValue([]),
        // 2 truy vấn findMany khác nhau: đơn theo người báo giá (assignee) và đơn theo người được giao
        findMany: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(
            args.where.assignedOrder
              ? opts.assigned
              : args.where.assignee
                ? (opts.pricerRows ?? [])
                : [],
          ),
        ),
      },
      user: {
        findMany: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(
            args.where.role === 'ORDER'
              ? [
                  { id: 'order-1', name: 'Order A' },
                  { id: 'order-2', name: 'Order B' },
                ]
              : [],
          ),
        ),
      },
      quoteOption: {
        findMany: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(
            opts.options.filter((o) => args.where.id.in.includes(o.id)),
          ),
        ),
      },
      auditLog: {
        findMany: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(
            (opts.audit ?? []).filter(
              (l) =>
                args.where.entityId.in.includes(l.entityId) &&
                args.where.action.in.includes(l.action),
            ),
          ),
        ),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteAnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return { service: module.get(QuoteAnalyticsService), prisma };
  }

  const medianOf = (res: any, id: string) =>
    res.pricerStats.items.find((p: any) => p.id === id).medianQuoteMs;

  it('Order bấm nhận muộn rồi báo giá trong 1 phút vẫn bị tính từ lúc đơn được giao', async () => {
    const { service } = await setup({
      assigned: [
        { id: 'r1', assignedOrderId: 'order-1', createdAt: at('08:00'), finalOptionId: 'o1' },
      ],
      options: [{ id: 'o1', quotedDate: at('10:01') }],
      // cách đo cũ (nhận → báo giá) sẽ ra 1 phút
      pricerRows: [
        { assigneeId: 'order-1', acceptedAt: at('10:00'), returnedAt: null, status: 'QUOTED', updatedAt: at('10:01'), finalOptionId: 'o1' },
      ],
    });
    expect(medianOf(await service.getStaffPerformance(), 'order-1')).toBe(121 * MIN);
  });

  it('trung vị theo từng người được giao: nhiều đơn, đơn chưa báo giá và đơn lệch không vào mẫu', async () => {
    const { service } = await setup({
      assigned: [
        { id: 'r1', assignedOrderId: 'order-1', createdAt: at('08:00'), finalOptionId: 'o1' }, // 121'
        { id: 'r2', assignedOrderId: 'order-1', createdAt: at('09:00'), finalOptionId: 'o2' }, // đã sửa giá → 30'
        { id: 'r3', assignedOrderId: 'order-1', createdAt: at('08:00'), finalOptionId: 'o3' }, // gửi lại lúc 11:00 → 20'
        { id: 'r4', assignedOrderId: 'order-1', createdAt: at('08:00'), finalOptionId: null }, // chưa báo giá
        { id: 'r5', assignedOrderId: 'order-2', createdAt: at('08:00'), finalOptionId: 'o5' }, // ngày báo giá lệch (âm)
      ],
      options: [
        { id: 'o1', quotedDate: at('10:01') },
        { id: 'o2', quotedDate: at('12:00') },
        { id: 'o3', quotedDate: at('11:20') },
        { id: 'o5', quotedDate: at('07:00') },
      ],
      audit: [
        { entityId: 'r2', action: 'QUOTE_PRICE', createdAt: at('09:30') },
        { entityId: 'r2', action: 'EDIT_QUOTED_PRICE', createdAt: at('12:00') },
        { entityId: 'r3', action: 'RESUBMIT_QUOTE', createdAt: at('11:00') },
      ],
    });
    const res = await service.getStaffPerformance();
    expect(medianOf(res, 'order-1')).toBe(30 * MIN); // trung vị của [121, 30, 20]
    expect(medianOf(res, 'order-2')).toBeNull();
  });

  it('chỉ truy vấn audit log cho các đơn đã báo giá, đúng loại đơn và các action cần dùng', async () => {
    const { service, prisma } = await setup({
      assigned: [
        { id: 'r1', assignedOrderId: 'order-1', createdAt: at('08:00'), finalOptionId: 'o1' },
        { id: 'r4', assignedOrderId: 'order-1', createdAt: at('08:00'), finalOptionId: null },
      ],
      options: [{ id: 'o1', quotedDate: at('10:00') }],
    });
    await service.getStaffPerformance();
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.entityType).toBe('QuoteRequest');
    expect(where.entityId).toEqual({ in: ['r1'] });
    expect([...where.action.in].sort()).toEqual(
      ['EDIT_QUOTED_PRICE', 'QUICK_APPROVE', 'QUOTE_PRICE', 'RESUBMIT_QUOTE'].sort(),
    );
  });

  it('lấy đơn theo người được giao đang hoạt động và theo kỳ lọc (ngày tạo đơn)', async () => {
    const { service, prisma } = await setup({ assigned: [], options: [] });
    await service.getStaffPerformance({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    } as any);
    const where = prisma.quoteRequest.findMany.mock.calls
      .map(([a]: any[]) => a.where)
      .find((w: any) => w.assignedOrder);
    expect(where.assignedOrder).toEqual({ role: 'ORDER', isActive: true });
    expect(where.createdAt).toBeDefined();
  });

  it('không có đơn nào được giao → không truy vấn audit log, trung vị null', async () => {
    const { service, prisma } = await setup({ assigned: [], options: [] });
    const res = await service.getStaffPerformance();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(medianOf(res, 'order-1')).toBeNull();
  });

  // Truy vấn user được phát theo thứ tự: [0] = danh sách SALE, [1] = danh sách ORDER.
  const userWhere = (callIndex: number) =>
    prisma.user.findMany.mock.calls[callIndex][0].where;

  it('teamId = id → lọc cả danh sách Sale lẫn Order theo team của chính người đó', async () => {
    await service.getStaffPerformance({ teamId: 't1' } as any);
    expect(userWhere(0)).toEqual({
      role: 'SALE',
      isActive: true,
      teamId: 't1',
    });
    expect(userWhere(1)).toEqual({
      role: 'ORDER',
      isActive: true,
      teamId: 't1',
    });
  });

  it("teamId = 'NONE' → chỉ người chưa có team (teamId null)", async () => {
    await service.getStaffPerformance({ teamId: 'NONE' } as any);
    expect(userWhere(0)).toEqual({
      role: 'SALE',
      isActive: true,
      teamId: null,
    });
    expect(userWhere(1)).toEqual({
      role: 'ORDER',
      isActive: true,
      teamId: null,
    });
  });

  it.each([undefined, '', 'ALL'])(
    'teamId = %p → không có khóa teamId trong where',
    async (teamId) => {
      await service.getStaffPerformance({ teamId } as any);
      expect(userWhere(0)).toEqual({ role: 'SALE', isActive: true });
      expect(userWhere(1)).toEqual({ role: 'ORDER', isActive: true });
    },
  );

  it('không truyền query → where giữ nguyên như trước (không khóa teamId)', async () => {
    await service.getStaffPerformance();
    expect(userWhere(0)).toEqual({ role: 'SALE', isActive: true });
    expect(userWhere(1)).toEqual({ role: 'ORDER', isActive: true });
  });
});
