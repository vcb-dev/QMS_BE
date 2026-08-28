import { Test, TestingModule } from '@nestjs/testing';
import { QuoteAnalyticsService } from '../src/quote-requests/quote/quote-analytics.service';
import { PrismaService } from '../src/prisma/prisma.service';

// getDashboardCharts() gọi 4 query song song (findMany timeline, groupBy sale, groupBy category,
// findMany price/material) rồi thêm 4 query phụ (user/category/material/option lookup) — mock
// Prisma bằng plain object jest.fn(), KHÔNG đụng DB thật.
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
        category: { name: 'Dây chuyền' },
        images: [{ id: 'img1', imageUrl: 'https://example.com/a.png' }],
      },
      materials: [{ material: { name: 'Vàng 24K' } }],
    },
    {
      id: 'o1',
      quotedPrice: 6_000_000,
      stonePrice: null,
      quoteRequest: {
        id: 'r1',
        category: { name: 'Nhẫn' },
        images: [],
      },
      materials: [{ material: { name: 'Vàng 18K' } }],
    },
  ];

  beforeEach(async () => {
    prisma = {
      quoteRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(TIMELINE_ROWS)
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
      productName: 'Dây chuyền Vàng 24K',
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
    expect(result.saleStats).toEqual(
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

  it('pricerStats tính avgQuoteMs từ finalOptionId.quotedDate - acceptedAt', async () => {
    const result = await service.getStaffPerformance();
    const pricer = result.pricerStats.find((p) => p.id === 'order-1');
    expect(pricer?.totalHandled).toBe(1);
    expect(pricer?.avgQuoteMs).toBe(5 * 60 * 60 * 1000); // 5 giờ
    expect(pricer?.avgProcessMs).toBe(5 * 60 * 60 * 1000);
  });
});
