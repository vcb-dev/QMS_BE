import {
  computeFinalOption,
  buildOptionCreateInput,
  buildLibraryProductName,
  computeLibraryGroupKey,
  computePriceBreakdown,
  computeCostBreakdown,
  mapOptionDetail,
  mapQuoteRequestDetail,
} from '../src/utils/option-mapper.util';

describe('computeCostBreakdown — cấu thành lãi/VAT từ cột đã lưu', () => {
  it('metalVat/metalProfit/stoneVat/stoneProfit khớp công thức', () => {
    // vốn kim loại thô 10tr, công 1tr, vat 10% -> vốn có VAT = 12.1tr
    // giá bán kim loại (totalMetalCost) 15tr -> lãi 2.9tr, VAT phần KL = 1.1tr
    // đá gốc 2tr, vat 10% -> có VAT 2.2tr; giá bán đá 3tr -> lãi 0.8tr, VAT đá 0.2tr
    expect(
      computeCostBreakdown({
        metalRawCost: 10_000_000,
        laborCost: 1_000_000,
        totalMetalCost: 15_000_000,
        stoneCost: 2_000_000,
        stonePrice: 3_000_000,
        vat: 10,
      }),
    ).toEqual({
      metalVatAmount: 1_100_000,
      metalProfit: 2_900_000,
      stoneVatAmount: 200_000,
      stoneProfit: 800_000,
    });
  });

  it('null khi thiếu metalRawCost / totalMetalCost (option nháp)', () => {
    expect(computeCostBreakdown({ vat: 10 })).toBeNull();
    expect(
      computeCostBreakdown({ metalRawCost: 5_000_000, vat: 10 }),
    ).toBeNull();
  });

  it('không đá -> phần đá = 0', () => {
    const out = computeCostBreakdown({
      metalRawCost: 10_000_000,
      laborCost: 0,
      totalMetalCost: 13_000_000,
      vat: 0,
    });
    expect(out).toEqual({
      metalVatAmount: 0,
      metalProfit: 3_000_000,
      stoneVatAmount: 0,
      stoneProfit: 0,
    });
  });
});

describe('mapQuoteRequestDetail — lọc ảnh data: URI', () => {
  it('bỏ ảnh có imageUrl bắt đầu data:, giữ link https', () => {
    const out = mapQuoteRequestDetail({
      images: [
        { id: '1', imageUrl: 'https://res.cloudinary.com/x/a.jpg' },
        { id: '2', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' },
      ],
      options: [],
    });
    expect(out.images).toEqual([
      { id: '1', imageUrl: 'https://res.cloudinary.com/x/a.jpg' },
    ]);
  });

  it('không có images -> giữ nguyên (undefined)', () => {
    expect(mapQuoteRequestDetail({ options: [] }).images).toBeUndefined();
  });
});

describe('computePriceBreakdown', () => {
  it('tách material = quotedPrice - stonePrice, stone = stonePrice', () => {
    expect(computePriceBreakdown(10_000_000, 3_000_000)).toEqual({
      material: 7_000_000,
      stone: 3_000_000,
    });
  });
  it('stone = 0 khi option không đính đá', () => {
    expect(computePriceBreakdown(5_000_000, 0)).toEqual({
      material: 5_000_000,
      stone: 0,
    });
    expect(computePriceBreakdown(5_000_000, null)).toEqual({
      material: 5_000_000,
      stone: 0,
    });
  });
  it('null khi chưa có giá', () => {
    expect(computePriceBreakdown(null, 0)).toBeNull();
    expect(computePriceBreakdown(undefined, 1000)).toBeNull();
  });
  it('ép Prisma Decimal (string) về number', () => {
    expect(computePriceBreakdown('10000000', '3000000')).toEqual({
      material: 7_000_000,
      stone: 3_000_000,
    });
  });
  it('mapOptionDetail gắn priceBreakdown khi có giá, bỏ khi chưa có', () => {
    expect(
      mapOptionDetail({
        quotedPrice: 8_000_000,
        stonePrice: 1_000_000,
        materials: [],
        stones: [],
      }).priceBreakdown,
    ).toEqual({ material: 7_000_000, stone: 1_000_000 });
    expect(
      mapOptionDetail({
        quotedPrice: null,
        stonePrice: null,
        materials: [],
        stones: [],
      }).priceBreakdown,
    ).toBeUndefined();
  });
});

describe('computeLibraryGroupKey', () => {
  const matBM = new Map<string, string | null>([
    ['m-vang18', 'bm-vang'],
    ['m-vang24', 'bm-vang'],
    ['m-bac', 'bm-bac'],
    ['m-da', null], // chất liệu phi kim loại
  ]);
  const stoneMeta = new Map([
    ['s-cz', { name: 'CZ 1.2mm', stoneType: 'MAIN' }],
    ['s-cz-lon', { name: 'cz 2.0mm', stoneType: 'MAIN' }],
    ['s-tam', { name: 'Đá tấm', stoneType: 'SIDE' }],
  ]);

  it('tuổi vàng + khối lượng KHÔNG tách nhóm (cùng base metal)', () => {
    const a = computeLibraryGroupKey(
      { materials: [{ materialId: 'm-vang18', weightChi: 3 }] },
      'cat-1',
      matBM,
      stoneMeta,
    );
    const b = computeLibraryGroupKey(
      { materials: [{ materialId: 'm-vang24', weightChi: 5 }] },
      'cat-1',
      matBM,
      stoneMeta,
    );
    expect(a).toBe('cat-1|bm-vang|');
    expect(b).toBe(a);
  });

  it('base metal khác nhau -> khóa khác', () => {
    const g = computeLibraryGroupKey(
      { materials: [{ materialId: 'm-bac', weightChi: 4 }] },
      'cat-1',
      matBM,
      stoneMeta,
    );
    expect(g).toBe('cat-1|bm-bac|');
  });

  it('nhiều chất liệu -> lấy base metal của cái NẶNG NHẤT có kim loại gốc', () => {
    const g = computeLibraryGroupKey(
      {
        materials: [
          { materialId: 'm-da', weightChi: 10 },
          { materialId: 'm-bac', weightChi: 2 },
        ],
      },
      'cat-1',
      matBM,
      stoneMeta,
    );
    expect(g).toBe('cat-1|bm-bac|');
  });

  it('đá MAIN vào khóa (lowercase + sort), đá SIDE bị bỏ', () => {
    const g = computeLibraryGroupKey(
      {
        materials: [{ materialId: 'm-vang18', weightChi: 3 }],
        stones: [
          { stoneId: 's-cz-lon' },
          { stoneId: 's-cz' },
          { stoneId: 's-tam' },
        ],
      },
      'cat-1',
      matBM,
      stoneMeta,
    );
    expect(g).toBe('cat-1|bm-vang|cz 1.2mm~cz 2.0mm');
  });

  it('toàn phi kim loại -> baseMetalId = none', () => {
    const g = computeLibraryGroupKey(
      { materials: [{ materialId: 'm-da', weightChi: 1 }] },
      'cat-1',
      matBM,
      stoneMeta,
    );
    expect(g).toBe('cat-1|none|');
  });
});

describe('buildLibraryProductName', () => {
  it('ghép thẳng danh mục + tên kim loại gốc', () => {
    expect(buildLibraryProductName('Nhẫn', 'Vàng 24K', [])).toBe(
      'Nhẫn Vàng 24K',
    );
  });
  it('thêm tên đá khi có đá cấu trúc', () => {
    expect(
      buildLibraryProductName('Nhẫn', 'Vàng 24K', ['Kim cương', 'Ruby']),
    ).toBe('Nhẫn Vàng 24K Kim cương, Ruby');
  });
  it('fallback khi thiếu cả danh mục lẫn kim loại', () => {
    expect(buildLibraryProductName(undefined, undefined, [])).toBe(
      'Sản phẩm chế tác',
    );
  });
});

describe('computeFinalOption', () => {
  it('trả null/null khi không có option nào', () => {
    expect(computeFinalOption([])).toEqual({
      finalOptionId: null,
      finalPrice: null,
    });
  });

  it('ưu tiên option CLOSED dù không phải mới nhất', () => {
    const options = [
      { id: 'o1', quotedPrice: 1_000_000, selectionStatus: 'NONE' },
      { id: 'o2', quotedPrice: 2_000_000, selectionStatus: 'CLOSED' },
      { id: 'o3', quotedPrice: 3_000_000, selectionStatus: 'NONE' },
    ];
    expect(computeFinalOption(options)).toEqual({
      finalOptionId: 'o2',
      finalPrice: 2_000_000,
    });
  });

  it('ưu tiên SELECTED khi không có CLOSED', () => {
    const options = [
      { id: 'o1', quotedPrice: 1_000_000, selectionStatus: 'NONE' },
      { id: 'o2', quotedPrice: 2_000_000, selectionStatus: 'SELECTED' },
    ];
    expect(computeFinalOption(options)).toEqual({
      finalOptionId: 'o2',
      finalPrice: 2_000_000,
    });
  });

  it('không có CLOSED/SELECTED — lấy option có giá MỚI NHẤT (cuối mảng, theo createdAt asc)', () => {
    const options = [
      { id: 'o1', quotedPrice: 1_000_000, selectionStatus: 'NONE' },
      { id: 'o2', quotedPrice: 2_000_000, selectionStatus: 'NONE' },
    ];
    expect(computeFinalOption(options)).toEqual({
      finalOptionId: 'o2',
      finalPrice: 2_000_000,
    });
  });

  it('chỉ có option nháp (chưa có giá) — lấy option đầu tiên, finalPrice null', () => {
    const options = [{ id: 'o1', quotedPrice: null, selectionStatus: 'NONE' }];
    expect(computeFinalOption(options)).toEqual({
      finalOptionId: 'o1',
      finalPrice: null,
    });
  });
});

describe('buildOptionCreateInput — dedupKey', () => {
  it('dedupKey ghép categoryId + chất liệu (sort theo materialId) + đá (sort theo stoneId)', () => {
    const result = buildOptionCreateInput(
      {
        optionName: 'PA1',
        quotedPrice: 5_000_000,
        weightChi: 2,
        materials: [
          { materialId: 'm2', weightChi: 1 },
          { materialId: 'm1', weightChi: 1 },
        ],
        stones: [
          { stoneId: 's2', quantity: 1 },
          { stoneId: 's1', quantity: 2 },
        ],
      },
      0,
      'cat-1',
    );
    expect(result.dedupKey).toBe('cat-1|m1:1,m2:1|s1:2,s2:1');
  });

  it('không có chất liệu — dùng matStr rỗng + weightChi; không có đá — "none"', () => {
    const result = buildOptionCreateInput(
      { optionName: 'PA1', quotedPrice: 1, weightChi: 3 },
      0,
      'cat-2',
    );
    expect(result.dedupKey).toBe('cat-2|:3|none');
  });

  it('có stoneDescription (không chọn từ danh mục) — dùng làm stoneKey', () => {
    const result = buildOptionCreateInput(
      {
        optionName: 'PA1',
        quotedPrice: 1,
        weightChi: 1,
        stoneDescription: 'Kim cương 2 ly',
      },
      0,
      'cat-3',
    );
    expect(result.dedupKey).toBe('cat-3|:1|Kim cương 2 ly');
  });
});
