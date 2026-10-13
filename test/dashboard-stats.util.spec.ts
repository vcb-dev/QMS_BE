// qms_be/src/utils/dashboard-stats.util.spec.ts
import {
  bucketTimeline,
  bucketCustomRange,
  bucketPriceRange,
} from '../src/utils/dashboard-stats.util';

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
      { createdAt: new Date('2026-01-05T10:00:00Z'), status: 'PENDING' },
      { createdAt: new Date('2026-01-05T11:00:00Z'), status: 'QUOTED' },
    ];
    const result = bucketTimeline(
      rows,
      'THIS_MONTH',
      new Date('2026-01-05T00:00:00Z'),
    );
    const day5 = result.find((b) => b.label === '05/01');
    expect(day5?.pending).toBe(1);
    expect(day5?.quoted).toBe(1);
    expect(day5?.total).toBe(2);
    // Trạng thái "Đã chốt" đã gỡ — bucket không còn khóa closed.
    expect(day5).not.toHaveProperty('closed');
  });

  it('bản ghi createdAt null bị bỏ qua, không throw', () => {
    const rows = [{ createdAt: null as any, status: 'PENDING' }];
    expect(() => bucketTimeline(rows, 'THIS_MONTH')).not.toThrow();
  });
});

// Khoảng ngày tùy chọn: FE gửi mốc đầu/cuối ngày (ISO). Mọi biên bucket tính theo NGÀY giờ VN (UTC+7),
// ví dụ '2026-01-14T17:00:00Z' = 00:00 ngày 15/01 giờ VN.
describe('bucketCustomRange', () => {
  it('khoảng trong đúng 1 ngày — chia 8 khung 3 giờ như TODAY', () => {
    // 01:30Z = 08:30 giờ VN -> khung "06-09h" (index 2)
    const rows = [
      { createdAt: new Date('2026-01-15T01:30:00Z'), status: 'PENDING' },
    ];
    const result = bucketCustomRange(
      rows,
      '2026-01-14T17:00:00.000Z',
      '2026-01-15T16:59:59.000Z',
    );
    expect(result).toHaveLength(8);
    expect(result[2].label).toBe('06-09h');
    expect(result[2].pending).toBe(1);
  });

  it('nhiều ngày — mỗi ngày giờ VN 1 cột, gồm cả ngày đầu và ngày cuối, qua ranh giới tháng', () => {
    const rows = [
      // 17:30Z ngày 31/01 = 00:30 ngày 01/02 giờ VN -> thuộc cột 01/02, không phải 31/01
      { createdAt: new Date('2026-01-31T17:30:00Z'), status: 'QUOTED' },
      { createdAt: new Date('2026-01-30T05:00:00Z'), status: 'PENDING' },
      // sau ngày cuối (03/02 giờ VN) -> bị bỏ qua
      { createdAt: new Date('2026-02-02T17:30:00Z'), status: 'PENDING' },
    ];
    const result = bucketCustomRange(
      rows,
      '2026-01-29T17:00:00.000Z', // 30/01 00:00 VN
      '2026-02-02T16:59:59.000Z', // 02/02 23:59:59 VN
    );
    expect(result.map((b) => b.label)).toEqual([
      '30/01',
      '31/01',
      '01/02',
      '02/02',
    ]);
    expect(result[0].pending).toBe(1);
    expect(result[2].quoted).toBe(1);
    expect(result.reduce((s, b) => s + b.total, 0)).toBe(2);
  });

  it('đúng 62 ngày vẫn là cột theo ngày; 63 ngày chuyển sang cột theo tháng', () => {
    // 01/01 -> 03/03/2026 giờ VN = 31 + 28 + 3 = 62 ngày
    const sixtyTwo = bucketCustomRange(
      [],
      '2025-12-31T17:00:00.000Z',
      '2026-03-03T16:59:59.000Z',
    );
    expect(sixtyTwo).toHaveLength(62);
    expect(sixtyTwo[0].label).toBe('01/01');

    const sixtyThree = bucketCustomRange(
      [],
      '2025-12-31T17:00:00.000Z',
      '2026-03-04T16:59:59.000Z',
    );
    expect(sixtyThree.map((b) => b.label)).toEqual([
      'Thg 1/26',
      'Thg 2/26',
      'Thg 3/26',
    ]);
  });

  it('khoảng dài qua nhiều năm — mỗi tháng 1 cột, đếm đúng vào tháng giờ VN', () => {
    const rows = [
      // 17:00Z ngày 30/11 = 00:00 ngày 01/12 giờ VN -> thuộc tháng 12
      { createdAt: new Date('2025-11-30T17:00:00Z'), status: 'QUOTED' },
      { createdAt: new Date('2026-02-09T03:00:00Z'), status: 'REJECTED' },
    ];
    const result = bucketCustomRange(
      rows,
      '2025-11-14T17:00:00.000Z', // 15/11/2025 VN
      '2026-02-10T16:59:59.000Z', // 10/02/2026 VN
    );
    expect(result.map((b) => b.label)).toEqual([
      'Thg 11/25',
      'Thg 12/25',
      'Thg 1/26',
      'Thg 2/26',
    ]);
    expect(result[1].quoted).toBe(1);
    expect(result[3].rejected).toBe(1);
  });

  it('không có endDate — kéo dài tới thời điểm hiện tại', () => {
    const result = bucketCustomRange(
      [],
      '2026-01-09T17:00:00.000Z', // 10/01 VN
      undefined,
      new Date('2026-01-12T03:00:00Z'), // 12/01 VN
    );
    expect(result.map((b) => b.label)).toEqual(['10/01', '11/01', '12/01']);
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

describe('bucketTimeline — đơn đã hủy', () => {
  it('bỏ qua dòng CANCELLED: không cộng vào total hay bất kỳ cột nào (phòng thủ lớp 2, đầu vào vốn đã lọc)', () => {
    const rows = [
      { createdAt: new Date('2026-01-05T10:00:00Z'), status: 'CANCELLED' },
      { createdAt: new Date('2026-01-05T11:00:00Z'), status: 'QUOTED' },
    ];
    const result = bucketTimeline(
      rows,
      'THIS_MONTH',
      new Date('2026-01-05T00:00:00Z'),
    );
    const day5 = result.find((b) => b.label === '05/01');
    expect(day5?.total).toBe(1);
    expect(day5?.quoted).toBe(1);
    expect(result.reduce((s, b) => s + b.total, 0)).toBe(1);
  });
});
