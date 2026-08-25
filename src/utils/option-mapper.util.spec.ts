import { computeFinalOption, buildOptionCreateInput } from './option-mapper.util';

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
    const result = buildOptionCreateInput({ optionName: 'PA1', quotedPrice: 1, weightChi: 3 }, 0, 'cat-2');
    expect(result.dedupKey).toBe('cat-2|:3|none');
  });

  it('có stoneDescription (không chọn từ danh mục) — dùng làm stoneKey', () => {
    const result = buildOptionCreateInput(
      { optionName: 'PA1', quotedPrice: 1, weightChi: 1, stoneDescription: 'Kim cương 2 ly' },
      0,
      'cat-3',
    );
    expect(result.dedupKey).toBe('cat-3|:1|Kim cương 2 ly');
  });
});

