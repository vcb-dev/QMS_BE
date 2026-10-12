// Build câu where-clause Prisma cho danh sách yêu cầu báo giá — THUẦN (filterDto + user vào, where
// object ra), tách khỏi QuoteQueryService để file service không bị chôn 200 dòng logic filter/thời
// gian giữa các đoạn query DB thật, khó đọc/khó bảo trì.

import { FilterQuoteRequestDto } from '../quote-requests/dto/filter-quote-request.dto';
import { QuoteStatus, User, Role } from '@prisma/client';
import { APP_CONSTANTS, FILTERABLE_QUOTE_STATUSES } from '../common/constants';
import { resolveDateRange } from './date-range.util';
import { buildTeamIdCondition } from './team-filter.util';
import {
  NOT_CANCELLED_WHERE,
  canSeeCancelledQuotes,
} from './quote-visibility.util';

// Cùng một bộ lọc nhưng đơn hủy được đối xử khác nhau tùy mục đích:
//  - 'totals' (MẶC ĐỊNH, an toàn nhất): thống kê/dashboard — loại đơn hủy cho MỌI role, kể cả ADMIN
//    và kể cả khi filter gửi status=CANCELLED.
//  - 'list': danh sách/export — non-admin luôn bị loại; ADMIN chỉ thấy đơn hủy khi chọn đúng
//    status=CANCELLED (tab "Đã hủy"), còn lại cũng bị loại.
//  - 'tabCounts': đếm theo tab — ADMIN không bị loại để groupBy trả cả nhóm CANCELLED (đếm riêng).
export type QuoteWhereScope = 'totals' | 'list' | 'tabCounts';

function cancelledVisibilityCondition(
  scope: QuoteWhereScope,
  user: User,
  status: QuoteStatus | undefined,
) {
  if (!canSeeCancelledQuotes(user?.role) || scope === 'totals') {
    return NOT_CANCELLED_WHERE;
  }
  if (scope === 'tabCounts') return null;
  return status === QuoteStatus.CANCELLED ? null : NOT_CANCELLED_WHERE;
}

export function buildQuoteWhereClause(
  filterDto: FilterQuoteRequestDto,
  _user: User,
  scope: QuoteWhereScope = 'totals',
) {
  const {
    status,
    search,
    customerId,
    requesterId,
    assigneeId,
    assignedOrderId,
    departmentId,
    teamId,
    categoryId,
    materialId,
    ownerId,
    startDate,
    endDate,
    timeRange,
    includeLocked,
  } = filterDto;

  const andConditions: any[] = [];

  // Điều kiện hiển thị đơn hủy nằm ở phần tử AND RIÊNG (không trộn vào status của người dùng) nên dù
  // người dùng chọn status/gõ từ khóa thế nào cũng chỉ THU HẸP kết quả, không thể nới ra.
  const cancelledCondition = cancelledVisibilityCondition(scope, _user, status);
  if (cancelledCondition) andConditions.push(cancelledCondition);

  if (customerId) {
    andConditions.push({ customerId });
  }

  const targetOwner = ownerId;
  if (targetOwner) {
    if (_user?.role === Role.ORDER) {
      andConditions.push({ assigneeId: targetOwner });
    } else {
      andConditions.push({ requesterId: targetOwner });
    }
  }

  if (status && FILTERABLE_QUOTE_STATUSES.includes(status)) {
    andConditions.push({ status: status });
  }

  if (requesterId) {
    andConditions.push({ requesterId });
  }

  if (assigneeId) {
    andConditions.push({ assigneeId });
  }

  if (assignedOrderId) {
    andConditions.push({ assignedOrderId });
  }

  if (departmentId && departmentId !== 'ALL') {
    andConditions.push({ departmentId });
  }

  // Team của người tạo đơn (requester) — không có cột team trên quote_requests nên lọc bằng join;
  // Sale đổi team thì các đơn cũ của họ chuyển theo team mới (đã chốt trong spec).
  const teamCondition = buildTeamIdCondition(teamId);
  if (teamCondition) {
    andConditions.push({ requester: teamCondition });
  }

  if (categoryId && categoryId !== 'ALL') {
    andConditions.push({ categoryId });
  }

  if (materialId && materialId !== 'ALL') {
    andConditions.push({
      options: { some: { materials: { some: { materialId } } } },
    });
  }

  if (search && search.trim() !== '') {
    andConditions.push(buildSearchCondition(search.trim()));
  }

  const dateCondition = buildDateRangeCondition(timeRange, startDate, endDate);
  if (dateCondition) {
    andConditions.push(dateCondition);
  }

  // Ẩn đơn PENDING/PROCESSING mà người tạo (Sale) hoặc người xử lý (Order) đã bị khóa tài khoản
  // (isActive=false) — không ai nên tiếp tục làm việc trên đơn của nhân viên không còn hoạt động.
  // Đơn đã có kết quả (QUOTED) không bị ảnh hưởng, vẫn là hồ sơ lịch sử bình thường.
  // Chỉ ADMIN bật includeLocked=true mới thấy lại được — role khác gửi cờ này bị bỏ qua.
  if (!(includeLocked === 'true' && _user?.role === Role.ADMIN)) {
    andConditions.push({
      OR: [
        { status: { notIn: [QuoteStatus.PENDING, QuoteStatus.PROCESSING] } },
        {
          AND: [
            { requester: { isActive: true } },
            { OR: [{ assigneeId: null }, { assignee: { isActive: true } }] },
          ],
        },
      ],
    });
  }

  return andConditions.length > 0 ? { AND: andConditions } : {};
}

function buildSearchCondition(trimmed: string) {
  const matchedStatuses = Object.entries(APP_CONSTANTS.QUOTE_STATUS_LABELS)
    .filter(([, label]) => label.toLowerCase().includes(trimmed.toLowerCase()))
    .map(([value]) => value as QuoteStatus);

  return {
    OR: [
      { code: { contains: trimmed, mode: 'insensitive' } },
      { productName: { contains: trimmed, mode: 'insensitive' } },
      { productCode: { contains: trimmed, mode: 'insensitive' } },
      { category: { name: { contains: trimmed, mode: 'insensitive' } } },
      { customer: { name: { contains: trimmed, mode: 'insensitive' } } },
      { customer: { phone: { contains: trimmed, mode: 'insensitive' } } },
      { customerMeasurements: { contains: trimmed, mode: 'insensitive' } },
      {
        options: {
          some: {
            materials: {
              some: {
                material: { name: { contains: trimmed, mode: 'insensitive' } },
              },
            },
          },
        },
      },
      { requester: { name: { contains: trimmed, mode: 'insensitive' } } },
      {
        // department là quan hệ của chính QuoteRequest (departmentId), User không có field này.
        department: { name: { contains: trimmed, mode: 'insensitive' } },
      },
      ...(matchedStatuses.length ? [{ status: { in: matchedStatuses } }] : []),
    ],
  };
}

function buildDateRangeCondition(
  timeRange: string | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
) {
  const range = resolveDateRange(timeRange, startDate, endDate);
  return range ? { createdAt: range } : null;
}
