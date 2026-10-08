// Logic thuần (không DB, không DI) quanh "Order được giao đơn": chọn Order được giao đơn mới sao cho
// trong mỗi ngày mọi Order nhận số đơn đều nhau, và đo thời gian từ lúc giao đơn tới lúc báo giá.
// Service chỉ nạp số liệu từ DB rồi gọi hàm ở đây.

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

export interface QuoteTurnaroundInput {
  createdAt: Date; // lúc Sale tạo đơn = lúc hệ thống giao đơn cho Order
  quotedDate: Date; // ngày báo giá của phương án đại diện — bị ghi lại mỗi lần sửa giá
  firstQuoteLogAt: Date | null; // log QUOTE_PRICE / QUICK_APPROVE sớm nhất của đơn
  edited: boolean; // đơn từng có log EDIT_QUOTED_PRICE
  resubmitLogs: Date[]; // các lần Sale gửi lại đơn sau khi bị trả
}

// Thời gian báo giá của 1 đơn, tính từ lúc GIAO đơn (không phải lúc Order bấm nhận — nếu không, để
// đơn nằm hàng giờ rồi mới bấm "Báo giá luôn" vẫn ra vài chục giây). Trả null nếu mẫu lệch (âm).
//  - Mốc cuối: ngày báo giá hiện có. Chỉ khi đơn đã bị sửa giá (quotedDate khi đó là lần sửa) mới
//    quay về log báo giá đầu tiên. Không dùng log cho đơn chưa sửa vì log được ghi TRƯỚC khi thao tác
//    thành công, lần báo giá thất bại cũng để lại log.
//  - Mốc đầu: lần Sale gửi lại gần nhất trước mốc cuối (thời gian chờ Sale bổ sung không tính cho
//    Order), không có thì lúc tạo đơn.
export function computeQuoteTurnaroundMs(
  i: QuoteTurnaroundInput,
): number | null {
  const end = i.edited && i.firstQuoteLogAt ? i.firstQuoteLogAt : i.quotedDate;
  let start = i.createdAt;
  for (const r of i.resubmitLogs) {
    if (r.getTime() <= end.getTime() && r.getTime() > start.getTime())
      start = r;
  }
  const dur = end.getTime() - start.getTime();
  return dur >= 0 ? dur : null;
}
