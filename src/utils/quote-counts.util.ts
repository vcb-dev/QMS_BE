// Đếm/gộp số liệu thống kê cho danh sách yêu cầu báo giá — tách khỏi QuoteQueryService vì dùng
// chung cho cả findAll (counts hiển thị trên tab) và getStats (KPI/dashboard).

import { PrismaService } from '../prisma/prisma.service';
import { QuoteStatus, User, Role } from '@prisma/client';
import { pickPrimaryOption } from './option-mapper.util';

export function countsFromGroupBy(
  res: { status: QuoteStatus; _count: { _all: number } }[],
  myReqCnt: number,
) {
  const map: Record<string, number> = {
    total: 0,
    myReq: myReqCnt,
    pending: 0,
    processing: 0,
    needMoreInfo: 0,
    quoted: 0,
    rejected: 0,
    closed: 0,
  };
  for (const item of res) {
    const cnt = item._count._all;
    map.total += cnt;
    if (item.status === QuoteStatus.PENDING) map.pending = cnt;
    else if (item.status === QuoteStatus.PROCESSING) map.processing = cnt;
    else if (item.status === QuoteStatus.NEED_MORE_INFO) map.needMoreInfo = cnt;
    else if (item.status === QuoteStatus.QUOTED) map.quoted = cnt;
    else if (item.status === QuoteStatus.REJECTED) map.rejected = cnt;
    else if (item.status === QuoteStatus.CLOSED) map.closed = cnt;
  }
  return map;
}

export function getMyReqCount(prisma: PrismaService, user: User) {
  if (!user?.id) return Promise.resolve(0);
  return prisma.quoteRequest.count({
    where:
      user.role === Role.ORDER
        ? { assigneeId: user.id }
        : { requesterId: user.id },
  });
}

// Giá đại diện của 1 request cho mục đích thống kê/hiển thị nhanh — dùng chung logic với
// pickPrimaryOption (ưu tiên option CLOSED, rồi SELECTED, rồi option có giá mới nhất).
// quotedPrice không còn ở QuoteRequest nên không thể groupBy._sum trực tiếp như trước,
// phải tự cộng ở app layer.
export function primaryOptionPrice(row: { options?: any[] }): number {
  const price = pickPrimaryOption(row)?.quotedPrice;
  return Number(price || 0);
}
