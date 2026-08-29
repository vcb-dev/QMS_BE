// Số tiền -> chuỗi định dạng VNĐ ("1.234.567 đ") — dùng chung cho mọi output do BE sinh ra
// (export Excel, message card Lark...). Khớp cách FE hiển thị ở qms_fe/src/utils/currency.ts.
// null/undefined/không phải số hữu hạn -> fallback (mặc định "Chưa có").
export function formatVnd(v: unknown, fallback = 'Chưa có'): string {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return `${Math.round(n).toLocaleString('vi-VN')} đ`;
}
