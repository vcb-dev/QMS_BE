// Quy tắc "ai được thấy đơn đã hủy (CANCELLED)" — MỘT chỗ duy nhất. Chỉ ADMIN thấy; với mọi role khác
// đơn hủy như đã biến mất khỏi mọi đường đọc (danh sách, đếm, chi tiết, thống kê, khách hàng, chat...).
//
// Mọi chỗ đọc `quote_requests` phải áp quy tắc này: dùng NOT_CANCELLED_WHERE / quoteVisibilityWhere cho
// Prisma, notCancelledSql cho SQL thô. Thêm đường đọc mới mà quên → test kiểm kê
// (test/cancelled-read-paths.spec.ts) sẽ đỏ.

import { Prisma, QuoteStatus, Role } from '@prisma/client';

export const NOT_CANCELLED_WHERE: Prisma.QuoteRequestWhereInput = {
  status: { not: QuoteStatus.CANCELLED },
};

// Role vắng (VD lời gọi nội bộ không truyền role) = coi như KHÔNG được thấy — an toàn theo mặc định.
export function canSeeCancelledQuotes(role?: Role | null): boolean {
  return role === Role.ADMIN;
}

// Điều kiện để ĐỌC ĐÚNG MỘT bản ghi (chi tiết, cổng chat, guard hành động). ADMIN: không lọc.
export function quoteVisibilityWhere(
  role?: Role | null,
): Prisma.QuoteRequestWhereInput {
  return canSeeCancelledQuotes(role) ? {} : NOT_CANCELLED_WHERE;
}

const SQL_ALIAS = /^[a-z_][a-z0-9_]*$/i;

// Fragment cho SQL thô (Prisma.sql). `alias` là alias bảng quote_requests trong câu SQL gọi (VD 'qr').
// Alias đi vào câu SQL qua Prisma.raw nên bắt buộc là định danh thuần.
export function notCancelledSql(alias: string): Prisma.Sql {
  if (!SQL_ALIAS.test(alias)) {
    throw new Error(`Alias SQL không hợp lệ: ${alias}`);
  }
  return Prisma.sql`${Prisma.raw(alias)}.status <> 'CANCELLED'`;
}
