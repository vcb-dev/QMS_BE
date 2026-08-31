import { Test, TestingModule } from '@nestjs/testing';
import { QuoteQueryService } from '../src/quote-requests/quote/quote-query.service';
import { LibraryService } from '../src/quote-requests/library/library.service';
import { QuoteListCacheService } from '../src/quote-requests/quote-list-cache.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuoteOptionsService } from '../src/quote-requests/quote-option/quote-options.service';

// Kim loại gốc dùng chung cho các option mock.
const BM_GOLD = { id: 'bm-gold', name: 'Vàng 24K' };

function goldMaterial(name: string, weightChi: number) {
  return {
    materialId: `mat-${name}`,
    weightChi,
    material: {
      id: `mat-${name}`,
      name,
      baseMetalId: BM_GOLD.id,
      baseMetal: BM_GOLD,
    },
  };
}

function opt(over: Partial<any> & { id: string; reqId: string }) {
  const { id, reqId, ...rest } = over;
  return {
    id,
    optionName: 'PA',
    quotedPrice: 5_000_000,
    vat: 10,
    quotedDate: new Date('2026-01-05'),
    weightChi: 2,
    laborCost: 0,
    stoneCost: 0,
    selectionStatus: 'NONE',
    materials: [goldMaterial('Vàng 18K (75%)', 2)],
    stones: [],
    quoteRequest: {
      id: reqId,
      code: `QG-${reqId}`,
      categoryId: 'cat-ring',
      createdAt: new Date('2026-01-04'),
      category: { name: 'Nhẫn' },
      requester: { name: `Sale ${reqId}` },
      assignee: { name: `Order ${reqId}` },
      images: [],
    },
    ...rest,
  };
}

// Mô phỏng computeLibraryGroupKey trên shape option đã hydrate — để test xác định option nào cùng nhóm.
function keyOf(o: any): string {
  const categoryId = o.quoteRequest?.categoryId || '';
  const mats = (o.materials || []).filter((m: any) => m.material?.baseMetalId);
  mats.sort(
    (a: any, b: any) => (Number(b.weightChi) || 0) - (Number(a.weightChi) || 0),
  );
  const baseMetalId = mats[0]?.material?.baseMetalId || 'none';
  const stoneKey = [
    ...new Set(
      (o.stones || [])
        .filter((s: any) => s.stone?.stoneType === 'MAIN' && s.stone?.name)
        .map((s: any) => String(s.stone.name).trim().toLowerCase()),
    ),
  ]
    .sort()
    .join('~');
  return `${categoryId}|${baseMetalId}|${stoneKey}`;
}

describe('LibraryService.getLibraryProducts — gộp nhóm + phân trang phía SQL', () => {
  let service: LibraryService;
  let prisma: any;
  let livePrices: Map<string, number>;

  // Dựng grpRows (kết quả SQL query 1) + hydrate CHỈ rep, đúng flow getLibraryProducts mới.
  function setup(options: any[], live: Record<string, number> = {}) {
    livePrices = new Map(Object.entries(live));
    const withKeys = options.map((o) => ({
      ...o,
      libraryGroupKey: o.libraryGroupKey ?? keyOf(o),
    }));

    const byKey = new Map<string, any[]>();
    for (const o of withKeys) {
      const b = byKey.get(o.libraryGroupKey);
      if (b) b.push(o);
      else byKey.set(o.libraryGroupKey, [o]);
    }

    const grpRows = [...byKey.entries()]
      .map(([gkey, arr]) => {
        const rep = [...arr].sort(
          (a, b) =>
            new Date(b.quotedDate || b.quoteRequest.createdAt).getTime() -
            new Date(a.quotedDate || a.quoteRequest.createdAt).getTime(),
        )[0];
        const byQuoted = [...arr].sort(
          (a, b) => (Number(a.quotedPrice) || 0) - (Number(b.quotedPrice) || 0),
        );
        const qs = arr
          .map((o) => Number(o.quotedPrice) || 0)
          .filter((x) => x > 0);
        const stoneVals = arr.map((o) => Number(o.stonePrice) || 0);
        const matVals = arr.map(
          (o) => (Number(o.quotedPrice) || 0) - (Number(o.stonePrice) || 0),
        );
        const ws = arr
          .map((o) => Number(o.weightChi) || 0)
          .filter((x) => x > 0);
        return {
          gkey,
          rep_id: rep.id,
          min_opt_id: byQuoted[0].id,
          max_opt_id: byQuoted[byQuoted.length - 1].id,
          dup_count: BigInt(new Set(arr.map((o) => o.quoteRequest.id)).size),
          q_min: Math.min(...qs),
          q_max: Math.max(...qs),
          mat_min: Math.min(...matVals),
          mat_max: Math.max(...matVals),
          stone_min: Math.min(...stoneVals),
          stone_max: Math.max(...stoneVals),
          w_min: ws.length ? Math.min(...ws) : null,
          w_max: ws.length ? Math.max(...ws) : null,
          last_at: new Date(
            Math.max(
              ...arr.map((o) =>
                new Date(o.quotedDate || o.quoteRequest.createdAt).getTime(),
              ),
            ),
          ),
          total: BigInt(byKey.size),
        };
      })
      .sort((a, b) => b.q_max - a.q_max || (a.gkey < b.gkey ? -1 : 1));

    const wantIds = new Set(
      grpRows.flatMap((r) => [r.rep_id, r.min_opt_id, r.max_opt_id]),
    );
    prisma.$queryRaw.mockResolvedValueOnce(grpRows);
    // Query 2 (repRows) — 1 dòng/khóa nhóm: id option đại diện + giá min + giá max.
    prisma.$queryRaw.mockResolvedValueOnce(
      grpRows.map((r) => ({
        gkey: r.gkey,
        rep_id: r.rep_id,
        min_opt_id: r.min_opt_id,
        max_opt_id: r.max_opt_id,
      })),
    );
    prisma.quoteOption.findMany.mockResolvedValue(
      withKeys.filter((o) => wantIds.has(o.id)),
    );
  }

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      quoteOption: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryService,
        QuoteListCacheService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: QuoteOptionsService,
          useValue: {
            batchComputeLivePrices: jest.fn(
              async (inputs: { key: string }[]) => {
                const m = new Map<
                  string,
                  { total: number; material: number; stone: number } | null
                >();
                for (const i of inputs) {
                  const n = livePrices.get(i.key);
                  m.set(
                    i.key,
                    n == null ? null : { total: n, material: n, stone: 0 },
                  );
                }
                return m;
              },
            ),
          },
        },
      ],
    }).compile();

    service = module.get<LibraryService>(LibraryService);
  });

  it('cùng danh mục + kim loại gốc, khác tuổi vàng & khối lượng → 1 thẻ; giá/khối lượng min–max từ SQL', async () => {
    setup([
      opt({
        id: 'o1',
        reqId: 'r1',
        weightChi: 2,
        quotedPrice: 4_000_000,
        materials: [goldMaterial('Vàng 18K (75%)', 2)],
      }),
      opt({
        id: 'o2',
        reqId: 'r2',
        weightChi: 3,
        quotedPrice: 6_000_000,
        materials: [goldMaterial('Vàng 14K (58.5%)', 3)],
      }),
    ]);

    const res = await service.getLibraryProducts({
      page: 1,
      limit: 8,
      sortMode: 'PRICE_DESC',
    });

    expect(res.data).toHaveLength(1);
    const card = res.data[0];
    expect(card.productName).toBe('Nhẫn Vàng 24K');
    expect(card.priceMin).toBe(4_000_000);
    expect(card.priceMax).toBe(6_000_000);
    expect(card.weightDisplay).toBe('2 – 3 chỉ');
    expect(card.matStr).toBe('Vàng 24K');
    expect(card.duplicateCount).toBe(2);
    expect(card.groupKey).toBe('cat-ring|bm-gold|');
    expect(card.history).toEqual([]); // history lazy-load riêng
    expect(res.meta.total).toBe(1);
  });

  it('giá hôm nay = live ĐÚNG của option giá thấp nhất / cao nhất (không dùng 1 tỉ lệ chung)', async () => {
    setup(
      [
        opt({ id: 'lo', reqId: 'r1', quotedPrice: 4_000_000 }),
        opt({ id: 'hi', reqId: 'r2', quotedPrice: 10_000_000 }),
      ],
      // lo biến động +25% (4tr→5tr), hi chỉ +2% (10tr→10.2tr) — khác ngày báo.
      { lo: 5_000_000, hi: 10_200_000 },
    );

    const res = await service.getLibraryProducts({
      page: 1,
      limit: 8,
      sortMode: 'PRICE_DESC',
    });
    const card = res.data[0];
    expect(card.priceMin).toBe(4_000_000);
    expect(card.priceMax).toBe(10_000_000);
    expect(card.livePriceMin).toBe(5_000_000);
    expect(card.livePriceMax).toBe(10_200_000);
  });

  it('thẻ trả range chất liệu / đá tách (đã báo) + range live tách', async () => {
    setup(
      [
        opt({
          id: 'o1',
          reqId: 'r1',
          quotedPrice: 8_000_000,
          stonePrice: 2_000_000,
        }),
        opt({
          id: 'o2',
          reqId: 'r2',
          quotedPrice: 12_000_000,
          stonePrice: 3_000_000,
        }),
      ],
      { o1: 9_000_000, o2: 13_000_000 },
    );

    const res = await service.getLibraryProducts({
      page: 1,
      limit: 8,
      sortMode: 'PRICE_DESC',
    });
    const card = res.data[0];
    // material = quoted - stone; stone = stone_price
    expect(card.priceMaterialMin).toBe(6_000_000);
    expect(card.priceMaterialMax).toBe(9_000_000);
    expect(card.priceStoneMin).toBe(2_000_000);
    expect(card.priceStoneMax).toBe(3_000_000);
    // mock batchComputeLivePrices trả stone = 0 → live material = live total, live stone = 0
    expect(card.livePriceMaterialMin).toBe(9_000_000);
    expect(card.livePriceMaterialMax).toBe(13_000_000);
    expect(card.livePriceStoneMin).toBe(0);
    expect(card.livePriceStoneMax).toBe(0);
  });

  it('đá chủ khác nhau → tách thẻ; đá tấm (SIDE) không tách nhóm', async () => {
    setup([
      opt({ id: 'o1', reqId: 'r1', quotedPrice: 5_000_000 }),
      opt({
        id: 'o2',
        reqId: 'r2',
        quotedPrice: 9_000_000,
        stones: [
          {
            stoneId: 's1',
            quantity: 1,
            stone: { id: 's1', name: 'Kim cương', stoneType: 'MAIN' },
          },
        ],
      }),
      opt({
        id: 'o3',
        reqId: 'r3',
        quotedPrice: 5_500_000,
        stones: [
          {
            stoneId: 's2',
            quantity: 10,
            stone: { id: 's2', name: 'Đá tấm CZ 1.2mm', stoneType: 'SIDE' },
          },
        ],
      }),
    ]);

    const res = await service.getLibraryProducts({
      page: 1,
      limit: 8,
      sortMode: 'PRICE_DESC',
    });

    // o1 + o3 (chỉ đá tấm) cùng nhóm trơn; o2 (đá chủ Kim cương) nhóm riêng.
    expect(res.meta.total).toBe(2);
    expect((res.data as any[]).map((d) => d.productName)).toEqual([
      'Nhẫn Vàng 24K Kim cương',
      'Nhẫn Vàng 24K',
    ]);
  });

  it('sort PRICE_DESC theo giá ĐÃ BÁO (q_max) — nhóm quotedPrice cao đứng trước, không theo giá sống', async () => {
    setup(
      [
        opt({
          id: 'o1',
          reqId: 'r1',
          quotedPrice: 3_000_000,
          quoteRequest: {
            id: 'r1',
            code: 'QG-r1',
            categoryId: 'cat-ring',
            createdAt: new Date('2026-01-04'),
            category: { name: 'Nhẫn' },
            images: [],
          },
        }),
        opt({
          id: 'o2',
          reqId: 'r2',
          quotedPrice: 12_000_000,
          materials: [
            {
              materialId: 'mat-x',
              weightChi: 2,
              material: {
                id: 'mat-x',
                name: 'Bạc',
                baseMetalId: 'bm-silver',
                baseMetal: { id: 'bm-silver', name: 'Bạc' },
              },
            },
          ],
          quoteRequest: {
            id: 'r2',
            code: 'QG-r2',
            categoryId: 'cat-ring',
            createdAt: new Date('2026-01-04'),
            category: { name: 'Nhẫn' },
            images: [],
          },
        }),
      ],
      { o1: 99_000_000, o2: 1_000_000 },
    );

    const res = await service.getLibraryProducts({
      page: 1,
      limit: 8,
      sortMode: 'PRICE_DESC',
    });
    expect((res.data as any[]).map((d) => d.productName)).toEqual([
      'Nhẫn Bạc',
      'Nhẫn Vàng 24K',
    ]);
  });
});

describe('LibraryService.getLibraryProductHistory — lịch sử báo giá 1 sản phẩm', () => {
  let service: LibraryService;
  let prisma: any;
  let livePrices: Map<string, number>;

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn(), quoteOption: { findMany: jest.fn() } };
    livePrices = new Map();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryService,
        QuoteListCacheService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: QuoteOptionsService,
          useValue: {
            batchComputeLivePrices: jest.fn(
              async (inputs: { key: string }[]) => {
                const m = new Map<
                  string,
                  { total: number; material: number; stone: number } | null
                >();
                for (const i of inputs) {
                  const n = livePrices.get(i.key);
                  m.set(
                    i.key,
                    n == null ? null : { total: n, material: n, stone: 0 },
                  );
                }
                return m;
              },
            ),
          },
        },
      ],
    }).compile();
    service = module.get(LibraryService);
  });

  it('gom option theo đơn, mới → cũ; price = giá đã báo, livePrice + deltaPct tính sẵn', async () => {
    livePrices = new Map([
      ['h1', 99_000_000],
      ['h2', 99_000_000],
      ['h3', 99_000_000],
    ]);
    // query 1: 2 đơn (r1 mới, r2 cũ)
    prisma.$queryRaw.mockResolvedValueOnce([
      { request_id: 'r1', total: 2n },
      { request_id: 'r2', total: 2n },
    ]);
    // query 2: id option
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'h1' },
      { id: 'h2' },
      { id: 'h3' },
    ]);
    prisma.quoteOption.findMany.mockResolvedValue([
      opt({
        id: 'h1',
        reqId: 'r1',
        optionName: 'PA1',
        quotedPrice: 5_000_000,
        quotedDate: new Date('2026-01-10'),
      }),
      opt({
        id: 'h2',
        reqId: 'r1',
        optionName: 'PA2',
        quotedPrice: 8_000_000,
        quotedDate: new Date('2026-01-10'),
      }),
      opt({
        id: 'h3',
        reqId: 'r2',
        optionName: 'PA1',
        quotedPrice: 4_000_000,
        quotedDate: new Date('2026-01-02'),
      }),
    ]);

    const res = await service.getLibraryProductHistory({
      groupKey: 'cat-ring|bm-gold|',
      page: 1,
      limit: 20,
    });

    expect(res.meta.total).toBe(2);
    expect(res.data).toHaveLength(2);
    expect(res.data[0].requestId).toBe('r1');
    expect(res.data[0].saleName).toBe('Sale r1');
    expect(res.data[0].options.map((o: any) => o.price)).toEqual([
      5_000_000, 8_000_000,
    ]);
    expect(res.data[0].options.map((o: any) => o.livePrice)).toEqual([
      99_000_000, 99_000_000,
    ]);
    expect(res.data[0].options.map((o: any) => o.livePriceDeltaPct)).toEqual([
      1880, 1137.5,
    ]);
    expect(res.data[0].priceMin).toBe(5_000_000);
    expect(res.data[0].priceMax).toBe(8_000_000);
    expect(res.data[1].requestId).toBe('r2');
  });
});

describe('QuoteQueryService — priceBreakdown tách giá chất liệu / giá đá', () => {
  it('stripCostFieldsForSale giữ priceBreakdown, bỏ giá vốn', () => {
    const svc = new QuoteQueryService({} as any, {} as any, {} as any);
    const out = (svc.stripCostFieldsForSale([
      {
        quotedPrice: 10_000_000,
        stonePrice: 3_000_000,
        totalMetalCost: 7_000_000,
        metalRawCost: 5_000_000,
        laborCost: 500_000,
        stoneCost: 2_000_000,
        priceBreakdown: { material: 7_000_000, stone: 3_000_000 },
      },
    ]) ?? [])[0];
    expect(out.priceBreakdown).toEqual({
      material: 7_000_000,
      stone: 3_000_000,
    });
    expect(out.stonePrice).toBeUndefined();
    expect(out.totalMetalCost).toBeUndefined();
    expect(out.metalRawCost).toBeUndefined();
    expect(out.laborCost).toBeUndefined();
    expect(out.stoneCost).toBeUndefined();
  });

  it('buildHistoryEntry gắn priceBreakdown mỗi option', () => {
    const svc = new LibraryService({} as any, {} as any, {} as any);
    const entry = svc['buildHistoryEntry']([
      {
        quoteRequest: {
          id: 'r1',
          code: 'C1',
          requester: {},
          assignee: null,
          createdAt: new Date(),
        },
        optionName: 'PA1',
        quotedPrice: 10_000_000,
        stonePrice: 3_000_000,
        weightChi: 2,
        quotedDate: new Date(),
      },
    ]);
    expect(entry.options[0].priceBreakdown).toEqual({
      material: 7_000_000,
      stone: 3_000_000,
    });
  });
});
