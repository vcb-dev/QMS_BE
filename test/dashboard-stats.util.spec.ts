// qms_be/src/utils/dashboard-stats.util.spec.ts
import { bucketTimeline, bucketPriceRange } from '../src/utils/dashboard-stats.util';

describe('bucketTimeline', () => {
  it('TODAY — chia 8 khung 3 giờ theo giờ VN (UTC+7)', () => {
    // 2026-01-15T01:30:00Z = 08:30 giờ VN -> khung "06-09h" (index 2)
    const rows = [
      { createdAt: new Date('2026-01-15T01:30:00Z'), status: 'PENDING' },
    ];
    const result = bucketTimeline(
      rows,
      'TODAY',
      new Date('2026-01-15T01:30:00Z'),
    );
    expect(result).toHaveLength(8);
    expect(result[2].label).toBe('06-09h');
    expect(result[2].pending).toBe(1);
    expect(result[2].total).toBe(1);
    expect(result.reduce((s, b) => s + b.total, 0)).toBe(1);
  });

  it('THIS_MONTH — mỗi ngày trong tháng 1 bucket, đếm đúng theo status', () => {
    const rows = [
      { createdAt: new Date('2026-01-05T10:00:00Z'), status: 'CLOSED' },
      { createdAt: new Date('2026-01-05T11:00:00Z'), status: 'QUOTED' },
    ];
    const result = bucketTimeline(
      rows,
      'THIS_MONTH',
      new Date('2026-01-05T00:00:00Z'),
    );
    const day5 = result.find((b) => b.label === '05/01');
    expect(day5?.closed).toBe(1);
    expect(day5?.quoted).toBe(1);
    expect(day5?.total).toBe(2);
  });

  it('bản ghi createdAt null bị bỏ qua, không throw', () => {
    const rows = [{ createdAt: null as any, status: 'PENDING' }];
    expect(() => bucketTimeline(rows, 'THIS_MONTH')).not.toThrow();
  });
});

describe('bucketPriceRange', () => {
  it('chia đúng 4 khoảng giá cố định', () => {
    const result = bucketPriceRange([
      3_000_000,
      10_000_000,
      20_000_000,
      40_000_000,
      0,
      null as any,
    ]);
    expect(result).toEqual([
      { label: '< 5tr', value: 1 },
      { label: '5-15tr', value: 1 },
      { label: '15-30tr', value: 1 },
      { label: '> 30tr', value: 1 },
    ]);
  });
});
