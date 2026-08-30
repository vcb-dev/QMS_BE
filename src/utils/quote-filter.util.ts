// Build câu where-clause Prisma cho danh sách yêu cầu báo giá — THUẦN (filterDto + user vào, where
// object ra), tách khỏi QuoteQueryService để file service không bị chôn 200 dòng logic filter/thời
// gian giữa các đoạn query DB thật, khó đọc/khó bảo trì.

import { FilterQuoteRequestDto } from '../quote-requests/dto/filter-quote-request.dto';
import { QuoteStatus, User, Role } from '@prisma/client';
import { APP_CONSTANTS } from '../common/constants';
import { resolveDateRange } from './date-range.util';

export function buildQuoteWhereClause(
  filterDto: FilterQuoteRequestDto,
  _user: User,
) {
  const {
    status,
    search,
    customerId,
    requesterId,
    assigneeId,
    categoryId,
    materialId,
    ownerId,
    startDate,
    endDate,
    timeRange,
    includeLocked,
  } = filterDto;

  const andConditions: any[] = [];

  if (customerId) {
    andConditions.push({ customerId });
  }

  const targetOwner = ownerId || requesterId;
  if (targetOwner) {
    if (_user?.role === Role.ORDER) {
      andConditions.push({ assigneeId: targetOwner });
    } else {
      andConditions.push({ requesterId: targetOwner });
    }
  }

  if (status && Object.values(QuoteStatus).includes(status)) {
    andConditions.push({ status: status });
  }

  if (assigneeId) {
    andConditions.push({ assigneeId });
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
  // Đơn đã có kết quả (QUOTED/CLOSED) không bị ảnh hưởng, vẫn là hồ sơ lịch sử bình thường.
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
        requester: {
          department: { name: { contains: trimmed, mode: 'insensitive' } },
        },
      },
      {
        assignee: {
          department: { name: { contains: trimmed, mode: 'insensitive' } },
        },
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
