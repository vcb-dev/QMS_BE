import {
  computeFinalOption,
  buildOptionCreateInput,
  buildLibraryProductName,
  computeLibraryGroupKey,
} from '../src/utils/option-mapper.util';

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
