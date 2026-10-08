import {
  OrderLoad,
  pickLeastLoadedOrder,
  startOfVietnamDay,
} from '../src/utils/order-assignment.util';

const at = (iso: string) => new Date(iso);

describe('pickLeastLoadedOrder', () => {
  it('không có Order nào → null (đơn vẫn được tạo, chỉ là chưa có người được giao)', () => {
    expect(pickLeastLoadedOrder([])).toBeNull();
  });

  it('chọn người có ít đơn được giao trong ngày nhất', () => {
    const pool: OrderLoad[] = [
      { id: 'a', assignedToday: 3, lastAssignedAt: at('2026-10-08T03:00:00Z') },
      { id: 'b', assignedToday: 1, lastAssignedAt: at('2026-10-08T04:00:00Z') },
      { id: 'c', assignedToday: 2, lastAssignedAt: at('2026-10-08T02:00:00Z') },
    ];
    expect(pickLeastLoadedOrder(pool)).toBe('b');
  });

  it('bằng số đơn → chọn người được giao cách đây lâu nhất (vòng tròn)', () => {
    const pool: OrderLoad[] = [
      { id: 'a', assignedToday: 2, lastAssignedAt: at('2026-10-08T05:00:00Z') },
      { id: 'b', assignedToday: 2, lastAssignedAt: at('2026-10-08T01:00:00Z') },
      { id: 'c', assignedToday: 2, lastAssignedAt: at('2026-10-08T03:00:00Z') },
    ];
    expect(pickLeastLoadedOrder(pool)).toBe('b');
  });

  it('người chưa từng được giao đơn nào được ưu tiên hơn người đã từng', () => {
    const pool: OrderLoad[] = [
      { id: 'a', assignedToday: 0, lastAssignedAt: at('2026-10-07T03:00:00Z') },
      { id: 'b', assignedToday: 0, lastAssignedAt: null },
    ];
    expect(pickLeastLoadedOrder(pool)).toBe('b');
  });

  it('hoà hoàn toàn → chọn theo id để kết quả ổn định, không phụ thuộc thứ tự mảng', () => {
    const pool: OrderLoad[] = [
      { id: 'z', assignedToday: 0, lastAssignedAt: null },
      { id: 'm', assignedToday: 0, lastAssignedAt: null },
      { id: 'a', assignedToday: 0, lastAssignedAt: null },
    ];
    expect(pickLeastLoadedOrder(pool)).toBe('a');
    expect(pickLeastLoadedOrder([...pool].reverse())).toBe('a');
  });

  it('không đổi mảng đầu vào', () => {
    const pool: OrderLoad[] = [
      { id: 'b', assignedToday: 1, lastAssignedAt: null },
      { id: 'a', assignedToday: 0, lastAssignedAt: null },
    ];
    const snapshot = JSON.stringify(pool);
    pickLeastLoadedOrder(pool);
    expect(JSON.stringify(pool)).toBe(snapshot);
  });

  it('giao liên tiếp 100 đơn cho 7 Order → mọi người chênh nhau tối đa 1 đơn', () => {
    const pool: OrderLoad[] = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'].map(
      (id) => ({ id, assignedToday: 0, lastAssignedAt: null }),
    );
    let clock = at('2026-10-08T01:00:00Z').getTime();
    for (let i = 0; i < 100; i++) {
      const id = pickLeastLoadedOrder(pool)!;
      const picked = pool.find((p) => p.id === id)!;
      picked.assignedToday += 1;
      clock += 60_000;
      picked.lastAssignedAt = new Date(clock);
    }
    const counts = pool.map((p) => p.assignedToday);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.reduce((s, n) => s + n, 0)).toBe(100);
  });
});

describe('startOfVietnamDay — "ngày" tính theo giờ Việt Nam (UTC+7), không theo timezone server', () => {
  it('00:30 sáng ngày 09/10 giờ VN (17:30Z ngày 08/10) → mốc 00:00 ngày 09/10 VN = 17:00Z', () => {
    expect(startOfVietnamDay(at('2026-10-08T17:30:00Z')).toISOString()).toBe(
      '2026-10-08T17:00:00.000Z',
    );
  });

  it('23:59 ngày 08/10 giờ VN (16:59Z) vẫn thuộc ngày 08/10 VN → mốc 17:00Z ngày 07/10', () => {
    expect(startOfVietnamDay(at('2026-10-08T16:59:00Z')).toISOString()).toBe(
      '2026-10-07T17:00:00.000Z',
    );
  });

  it('đúng 00:00 giờ VN → chính mốc đó', () => {
    expect(startOfVietnamDay(at('2026-10-07T17:00:00Z')).toISOString()).toBe(
      '2026-10-07T17:00:00.000Z',
    );
  });
});
