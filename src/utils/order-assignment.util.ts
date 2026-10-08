// Logic thuần (không DB, không DI) chọn Order được giao đơn mới sao cho trong mỗi ngày mọi Order
// nhận số đơn đều nhau. Service chỉ nạp số liệu từ DB rồi gọi hàm ở đây.

export interface OrderLoad {
  id: string;
  // Số đơn đã giao cho người này kể từ 00:00 hôm nay (giờ Việt Nam)
  assignedToday: number;
  // Lần gần nhất được giao đơn, tính trên toàn thời gian — dùng để xoay vòng khi hoà số đơn.
  // null = chưa từng được giao đơn nào.
  lastAssignedAt: Date | null;
}

// Việt Nam cố định UTC+7, không có giờ mùa hè. Tính "ngày" theo múi giờ này chứ không theo
// timezone của server (Docker/Railway thường chạy UTC → 00:00 UTC là 07:00 sáng VN, đếm sai ngày).
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfVietnamDay(now: Date): Date {
  const vnMs = now.getTime() + VN_OFFSET_MS;
  return new Date(vnMs - (vnMs % DAY_MS) - VN_OFFSET_MS);
}

// Ít đơn trong ngày nhất → hoà thì người được giao cách đây lâu nhất (chưa từng = lâu nhất) →
// hoà nữa thì theo id. Tiêu chí thứ 2 dùng mốc toàn thời gian để vòng quay nối tiếp qua các ngày,
// không dồn đơn đầu ngày về cùng một người; tiêu chí cuối giúp kết quả không phụ thuộc thứ tự mảng.
export function pickLeastLoadedOrder(candidates: OrderLoad[]): string | null {
  if (candidates.length === 0) return null;

  const lastAssignedMs = (c: OrderLoad) =>
    c.lastAssignedAt ? c.lastAssignedAt.getTime() : -Infinity;

  const sorted = [...candidates].sort(
    (a, b) =>
      a.assignedToday - b.assignedToday ||
      lastAssignedMs(a) - lastAssignedMs(b) ||
      a.id.localeCompare(b.id),
  );
  return sorted[0].id;
}
