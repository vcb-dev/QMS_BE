// Nguồn DUY NHẤT quy đổi bộ lọc thời gian (nút lọc nhanh `timeRange` hoặc khoảng ngày tùy chọn
// `startDate`/`endDate`) thành cặp mốc { gte, lte }. Trước đây logic này bị copy ở
// quote-filter.util.ts và customers.service.ts — mỗi nơi lệch nhau một chút (clamp cuối ngày,
// tập hợp preset hỗ trợ). Gộp về đây để mọi endpoint (yêu cầu báo giá, khách hàng, nhân viên,
// audit log) hiểu "Tháng này" giống hệt nhau.

export type DateRange = { gte?: Date; lte?: Date };

// Ưu tiên khoảng ngày tùy chọn nếu người dùng nhập startDate; chỉ dùng nút lọc nhanh khi không có
// startDate. endDate luôn được kéo tới 23:59:59 của ngày đó — người chọn "đến 30/08" muốn gồm cả
// ngày 30/08, không phải cắt lúc 00:00.
export function resolveDateRange(
  timeRange?: string,
  startDate?: string,
  endDate?: string,
): DateRange | null {
  if (!timeRange && !startDate && !endDate) return null;

  let start: Date | undefined = startDate ? new Date(startDate) : undefined;
  let end: Date | undefined = endDate ? endOfDay(new Date(endDate)) : undefined;

  if (timeRange && timeRange !== 'ALL' && !start) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const weekMonday = d - (now.getDay() || 7) + 1;

    switch (timeRange) {
      case 'TODAY':
        start = new Date(y, m, d, 0, 0, 0);
        end = new Date(y, m, d, 23, 59, 59);
        break;
      case 'THIS_WEEK':
        start = new Date(y, m, weekMonday, 0, 0, 0);
        break;
      case 'LAST_WEEK':
        start = new Date(y, m, weekMonday - 7, 0, 0, 0);
        end = new Date(y, m, weekMonday - 1, 23, 59, 59);
        break;
      case 'THIS_MONTH':
        start = new Date(y, m, 1, 0, 0, 0);
        break;
      case 'LAST_MONTH':
        start = new Date(y, m - 1, 1, 0, 0, 0);
        end = new Date(y, m, 0, 23, 59, 59);
        break;
      case 'THIS_YEAR':
        start = new Date(y, 0, 1, 0, 0, 0);
        break;
      default:
        break;
    }
  }

  const range: DateRange = {};
  if (start) range.gte = start;
  if (end) range.lte = end;
  return range.gte || range.lte ? range : null;
}

function endOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
  );
}
