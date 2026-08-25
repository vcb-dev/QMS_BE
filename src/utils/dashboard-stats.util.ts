// qms_be/src/utils/dashboard-stats.util.ts
// Bucket dữ liệu Dashboard theo giờ Việt Nam CỐ ĐỊNH (UTC+7, không có DST) — không phụ thuộc
// timezone máy chủ. Giữ nguyên đúng biên mốc bucket đã có ở FE (DashboardPage.tsx cũ) khi chuyển
// tính toán xuống BE.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function toVnParts(d: Date) {
  const shifted = new Date(d.getTime() + VN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-11
    date: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    day: shifted.getUTCDay(), // 0=CN..6=T7
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export interface TimelineBucket {
  key: string;
  label: string;
  pending: number;
  processing: number;
  needMoreInfo: number;
  quoted: number;
  rejected: number;
  closed: number;
  total: number;
}

function makeBucket(key: string, label: string): TimelineBucket {
  return {
    key,
    label,
    pending: 0,
    processing: 0,
    needMoreInfo: 0,
    quoted: 0,
    rejected: 0,
    closed: 0,
    total: 0,
  };
}

function increment(b: TimelineBucket, status: string) {
  b.total += 1;
  if (status === 'PENDING') b.pending += 1;
  else if (status === 'PROCESSING') b.processing += 1;
  else if (status === 'NEED_MORE_INFO') b.needMoreInfo += 1;
  else if (status === 'QUOTED') b.quoted += 1;
  else if (status === 'REJECTED') b.rejected += 1;
  else if (status === 'CLOSED') b.closed += 1;
}

export function bucketTimeline(
  rows: { createdAt: Date | string | null; status: string }[],
  timeRange: string,
  now: Date = new Date(),
): TimelineBucket[] {
  const nowVn = toVnParts(now);
  const buckets: TimelineBucket[] = [];
  const map = new Map<string, TimelineBucket>();
  const add = (key: string, label: string) => {
    const b = makeBucket(key, label);
    map.set(key, b);
    buckets.push(b);
  };

  if (timeRange === 'TODAY') {
    [
      '00-03h',
      '03-06h',
      '06-09h',
      '09-12h',
      '12-15h',
      '15-18h',
      '18-21h',
      '21-24h',
    ].forEach((l) => add(l, l));
    for (const r of rows) {
      if (!r.createdAt) continue;
      const { hours } = toVnParts(new Date(r.createdAt));
      const idx = Math.min(Math.floor(hours / 3), 7);
      increment(buckets[idx], r.status);
    }
  } else if (timeRange === 'THIS_WEEK') {
    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const mondayOffset = nowVn.day === 0 ? -6 : 1 - nowVn.day;
    const mondayMs = Date.UTC(
      nowVn.year,
      nowVn.month,
      nowVn.date + mondayOffset,
    );
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayMs + i * 86_400_000);
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      add(
        key,
        `${dayNames[i]} (${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)})`,
      );
    }
    for (const r of rows) {
      if (!r.createdAt) continue;
      const p = toVnParts(new Date(r.createdAt));
      const key = `${p.year}-${pad2(p.month + 1)}-${pad2(p.date)}`;
      const b = map.get(key);
      if (b) increment(b, r.status);
    }
  } else if (timeRange === 'THIS_MONTH' || timeRange === 'LAST_MONTH') {
    let year = nowVn.year;
    let month = nowVn.month;
    if (timeRange === 'LAST_MONTH') {
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
    }
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let i = 1; i <= daysInMonth; i++) {
      const key = `${year}-${pad2(month + 1)}-${pad2(i)}`;
      add(key, `${pad2(i)}/${pad2(month + 1)}`);
    }
    for (const r of rows) {
      if (!r.createdAt) continue;
      const p = toVnParts(new Date(r.createdAt));
      const key = `${p.year}-${pad2(p.month + 1)}-${pad2(p.date)}`;
      const b = map.get(key);
      if (b) increment(b, r.status);
    }
  } else if (timeRange === 'THIS_YEAR') {
    for (let i = 0; i < 12; i++) {
      const key = `${nowVn.year}-${pad2(i + 1)}`;
      add(key, `Thg ${i + 1}`);
    }
    for (const r of rows) {
      if (!r.createdAt) continue;
      const p = toVnParts(new Date(r.createdAt));
      const key = `${p.year}-${pad2(p.month + 1)}`;
      const b = map.get(key);
      if (b) increment(b, r.status);
    }
  } else {
    // ALL: 12 tháng gần nhất — bản ghi ngoài phạm vi này bị bỏ qua (giữ đúng hành vi FE cũ)
    for (let i = 11; i >= 0; i--) {
      let m = nowVn.month - i;
      let y = nowVn.year;
      while (m < 0) {
        m += 12;
        y -= 1;
      }
      const key = `${y}-${pad2(m + 1)}`;
      add(key, `Thg ${m + 1}/${String(y).slice(-2)}`);
    }
    for (const r of rows) {
      if (!r.createdAt) continue;
      const p = toVnParts(new Date(r.createdAt));
      const key = `${p.year}-${pad2(p.month + 1)}`;
      const b = map.get(key);
      if (b) increment(b, r.status);
    }
  }

  return buckets;
}

export const PRICE_RANGES = [
  { label: '< 5tr', min: 0, max: 5_000_000 },
  { label: '5-15tr', min: 5_000_000, max: 15_000_000 },
  { label: '15-30tr', min: 15_000_000, max: 30_000_000 },
  { label: '> 30tr', min: 30_000_000, max: Infinity },
];

export function bucketPriceRange(
  prices: (number | null | undefined)[],
): { label: string; value: number }[] {
  const buckets = PRICE_RANGES.map((r) => ({ label: r.label, value: 0 }));
  for (const price of prices) {
    if (price == null || price <= 0) continue;
    const idx = PRICE_RANGES.findIndex((r) => price >= r.min && price < r.max);
    if (idx >= 0) buckets[idx].value += 1;
  }
  return buckets;
}
