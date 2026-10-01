import { LibraryService } from '../src/quote-requests/library/library.service';

const BM_GOLD = { id: 'bm-gold', name: 'Vàng 24K' };
const BM_SILVER = { id: 'bm-silver', name: 'Bạc' };

function material(name: string, weightChi: number, baseMetal = BM_GOLD) {
  return {
    materialId: `mat-${name}`,
    weightChi,
    material: {
      id: `mat-${name}`,
      name,
      baseMetalId: baseMetal.id,
      baseMetal,
    },
  };
}

function mainStone(name: string) {
  return {
    stoneId: `st-${name}`,
    quantity: 1,
    stone: { id: `st-${name}`, name, stoneType: 'MAIN' },
  };
}

function sideStone(name: string) {
  return {
    stoneId: `st-${name}`,
    quantity: 10,
    stone: { id: `st-${name}`, name, stoneType: 'SIDE' },
  };
}

// Option đã hydrate — mang cả field giá vốn để test chắc chắn không lọt ra payload thẻ.
function option(over: Partial<any> & { id: string }) {
  return {
    optionName: 'PA',
    quotedPrice: 5_000_000,
    stonePrice: 0,
    vat: 10,
    quotedDate: new Date('2026-01-05'),
    weightChi: 2,
    laborCost: 111,
    stoneCost: 222,
    totalMetalCost: 333,
    metalRawCost: 444,
    selectionStatus: 'NONE',
    materials: [material('Vàng 18K (75%)', 2)],
    stones: [],
    ...over,
  };
}

function request(over: Partial<any> & { id: string; options: any[] }) {
  return {
    code: `QG-${over.id}`,
    createdAt: new Date('2026-01-04'),
    category: { name: 'Nhẫn' },
    requester: { name: `Sale ${over.id}` },
    assignee: { name: `Order ${over.id}` },
    images: [],
    ...over,
  };
}

describe('LibraryService.getLibraryProducts — mỗi yêu cầu là 1 sản phẩm', () => {
  let service: LibraryService;
  let prisma: any;
  let livePrices: Map<string, number>;

  // pageRows = kết quả SQL (thứ tự đã sort + phân trang); requests = kết quả hydrate (thứ tự bất kỳ).
  function setup(requests: any[], live: Record<string, number> = {}) {
    livePrices = new Map(Object.entries(live));
    prisma.$queryRaw.mockResolvedValueOnce(
      requests.map((r) => ({
        request_id: r.id,
        total: BigInt(requests.length),
      })),
    );
    prisma.quoteRequest.findMany.mockResolvedValue([...requests].reverse());
  }

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      quoteRequest: { findMany: jest.fn() },
    };
    const quoteOptionsService = {
      batchComputeLivePrices: jest.fn(async (inputs: { key: string }[]) => {
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
      }),
    };
    service = new LibraryService(prisma, quoteOptionsService as any);
  });

  it('2 yêu cầu cùng danh mục + chất liệu KHÔNG bị gộp — ra 2 thẻ theo đúng thứ tự SQL', async () => {
    setup([
      request({ id: 'r1', options: [option({ id: 'o1' })] }),
      request({ id: 'r2', options: [option({ id: 'o2' })] }),
    ]);

    const res = await service.getLibraryProducts({ page: 1, limit: 8 });

    expect(res.meta.total).toBe(2);
    expect(res.data.map((c) => c.requestId)).toEqual(['r1', 'r2']);
    expect(res.data.map((c) => c.code)).toEqual(['QG-r1', 'QG-r2']);
    expect(res.data[0].productName).toBe('Nhẫn Vàng 24K');
  });

  it('thẻ tổng hợp mọi phương án đã báo của yêu cầu: khoảng giá, khối lượng, chất liệu', async () => {
    setup([
      request({
        id: 'r1',
        options: [
          option({
            id: 'o1',
            optionName: 'PA 14K',
            quotedPrice: 4_000_000,
            weightChi: 2,
            materials: [material('Vàng 14K (58.5%)', 2)],
          }),
          option({
            id: 'o2',
            optionName: 'PA 18K',
            quotedPrice: 6_000_000,
            weightChi: 3,
            materials: [material('Vàng 18K (75%)', 3)],
          }),
        ],
      }),
    ]);

    const [card] = (await service.getLibraryProducts({})).data;

    expect(card.priceMin).toBe(4_000_000);
    expect(card.priceMax).toBe(6_000_000);
    expect(card.weightDisplay).toBe('2 – 3 chỉ');
    expect(card.matStr).toBe('Vàng 14K, Vàng 18K');
    expect(card.options.map((o) => o.optionName)).toEqual(['PA 14K', 'PA 18K']);
    expect(card.options.map((o) => o.price)).toEqual([4_000_000, 6_000_000]);
  });

  it('tên sản phẩm lấy theo phương án đại diện; đá chủ vào tên, đá tấm thì không', async () => {
    setup([
      request({
        id: 'r1',
        options: [
          option({
            id: 'o1',
            stones: [mainStone('Kim cương'), sideStone('CZ 1.2mm')],
          }),
        ],
      }),
      request({
        id: 'r2',
        category: { name: 'Bông tai' },
        options: [
          option({
            id: 'o2',
            materials: [material('Bạc 925', 1, BM_SILVER)],
          }),
        ],
      }),
    ]);

    const res = await service.getLibraryProducts({});

    expect(res.data.map((c) => c.productName)).toEqual([
      'Nhẫn Vàng 24K Kim cương',
      'Bông tai Bạc',
    ]);
    expect(res.data[0].stoneDisplay).toBe('Kim cương');
    expect(res.data[1].stoneDisplay).toBe('Không đính đá');
  });

  it('phương án đã chốt (CLOSED) quyết định tên sản phẩm dù không phải phương án báo gần nhất', async () => {
    setup([
      request({
        id: 'r1',
        options: [
          option({
            id: 'o1',
            selectionStatus: 'CLOSED',
            stones: [mainStone('Ruby')],
          }),
          option({ id: 'o2', selectionStatus: 'NONE' }),
        ],
      }),
    ]);

    const [card] = (await service.getLibraryProducts({})).data;

    expect(card.productName).toBe('Nhẫn Vàng 24K Ruby');
    expect(card.options.find((o) => o.selectionStatus === 'CLOSED')).toBeDefined();
  });

  it('giá hôm nay: min/max giá sống các phương án, delta % từng phương án; null khi không tính được', async () => {
    setup(
      [
        request({
          id: 'r1',
          options: [
            option({ id: 'lo', quotedPrice: 4_000_000 }),
            option({ id: 'hi', quotedPrice: 10_000_000 }),
          ],
        }),
        request({ id: 'r2', options: [option({ id: 'nolive' })] }),
      ],
      // lo +25% (4tr→5tr), hi +2% (10tr→10.2tr); nolive không có giá sống
      { lo: 5_000_000, hi: 10_200_000 },
    );

    const res = await service.getLibraryProducts({});
    const [withLive, withoutLive] = res.data;

    expect(withLive.livePriceMin).toBe(5_000_000);
    expect(withLive.livePriceMax).toBe(10_200_000);
    expect(withLive.options.map((o) => o.livePriceDeltaPct)).toEqual([25, 2]);
    expect(withoutLive.livePriceMin).toBeNull();
    expect(withoutLive.livePriceMax).toBeNull();
    expect(withoutLive.options[0].livePrice).toBeNull();
  });

  it('phương án gắn priceBreakdown tách giá kim loại / đá', async () => {
    setup([
      request({
        id: 'r1',
        options: [
          option({ id: 'o1', quotedPrice: 10_000_000, stonePrice: 3_000_000 }),
        ],
      }),
    ]);

    const [card] = (await service.getLibraryProducts({})).data;

    expect(card.options[0].priceBreakdown).toEqual({
      material: 7_000_000,
      stone: 3_000_000,
    });
  });

  it('payload thẻ không chứa giá vốn / lãi — Sale và Order nhận cùng dữ liệu', async () => {
    setup([
      request({
        id: 'r1',
        options: [option({ id: 'o1', stonePrice: 1_000_000 })],
      }),
    ]);

    const res = await service.getLibraryProducts({});
    const json = JSON.stringify(res);

    for (const forbidden of [
      'laborCost',
      'stoneCost',
      'totalMetalCost',
      'metalRawCost',
      'costBreakdown',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('không có yêu cầu nào khớp → data rỗng, không hydrate', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const res = await service.getLibraryProducts({ page: 1, limit: 8 });

    expect(res.data).toEqual([]);
    expect(res.meta).toEqual({ total: 0, page: 1, limit: 8, totalPages: 1 });
    expect(prisma.quoteRequest.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['PRICE_DESC', 'ORDER BY q_max DESC'],
    ['PRICE_ASC', 'ORDER BY q_min ASC'],
    ['RECENT', 'ORDER BY last_at DESC'],
  ])('sortMode %s → SQL %s', async (sortMode, orderBy) => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await service.getLibraryProducts({ sortMode });

    expect(prisma.$queryRaw.mock.calls[0][0].sql).toContain(orderBy);
  });
});
