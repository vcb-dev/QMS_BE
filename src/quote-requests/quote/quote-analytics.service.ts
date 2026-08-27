import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FilterQuoteRequestDto } from '../dto/filter-quote-request.dto';
import { QuoteStatus, User, Role } from '@prisma/client';
import { buildQuoteWhereClause } from '../../utils/quote-filter.util';
import {
  countsFromGroupBy,
  getMyReqCount,
} from '../../utils/quote-counts.util';
import {
  bucketTimeline,
  bucketPriceRange,
} from '../../utils/dashboard-stats.util';

// Tách khỏi QuoteQueryService (god-service cũ gộp cả read path chính lẫn thống kê/dashboard) —
// 3 hàm ở đây chỉ đọc/tổng hợp số liệu cho Dashboard/Hiệu suất, không đụng cache danh sách hay
// live price, nên tách riêng để mỗi service giữ đúng 1 trách nhiệm.
@Injectable()
export class QuoteAnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Aggregated stats only (counts + revenue sums) — no item rows fetched.
   * Dùng cho % thay đổi kỳ trước & KPI, thay vì kéo cả list rồi tính tay ở FE.
   */
  async getStats(filterDto: FilterQuoteRequestDto, _user: User) {
    const where = buildQuoteWhereClause(filterDto, _user);

    const [groupByRes, myReqCnt, revenueGroups] = await Promise.all([
      this.prisma.quoteRequest.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      getMyReqCount(this.prisma, _user),
      // Doanh thu = SUM(final_price) theo status. final_price là cột denorm được DB trigger giữ
      // đúng bằng quotedPrice của phương án đại diện (pickPrimaryOption) — cộng thẳng ở Postgres,
      // không kéo options của mọi request về RAM rồi tính tay như trước.
      this.prisma.quoteRequest.groupBy({
        by: ['status'],
        where: {
          ...where,
          status: { in: [QuoteStatus.QUOTED, QuoteStatus.CLOSED] },
        },
        _sum: { finalPrice: true },
      }),
    ]);

    const counts = countsFromGroupBy(groupByRes, myReqCnt);

    const sumFor = (s: QuoteStatus) =>
      Number(revenueGroups.find((g) => g.status === s)?._sum.finalPrice ?? 0);
    const closedRevenue = sumFor(QuoteStatus.CLOSED);
    const quotedRevenue = sumFor(QuoteStatus.QUOTED);

    const closeRate =
      counts.total > 0 ? (counts.closed / counts.total) * 100 : 0;

    return {
      total: counts.total,
      closeRate,
      closedRevenue,
      quotedRevenue,
      counts,
    };
  }

  /**
   * Dữ liệu 6 biểu đồ/bảng của Dashboard (timeline, sale ranking, phân bố danh mục/chất liệu/giá,
   * sản phẩm nổi bật) — tính hết ở BE, gọi 1 lần cho kỳ hiện tại (KHÔNG gọi lại cho kỳ trước, kỳ
   * trước chỉ cần getStats()). Dùng finalOptionId (đúng phương án CLOSED/SELECTED) cho
   * materialDistribution/featuredProducts thay vì "option mới nhất" như hành vi FE cũ.
   */
  async getDashboardCharts(filterDto: FilterQuoteRequestDto, _user: User) {
    const where = buildQuoteWhereClause(filterDto, _user);

    // bucketTimeline chỉ vẽ 1 tháng (mặc định) hoặc 12 tháng ('ALL'). Khi filter không có mốc
    // createdAt nào (timeRange rỗng, hoặc 'ALL' — buildDateRangeCondition trả null cho 2 case này)
    // thì query dưới sẽ kéo TOÀN BỘ lịch sử về chỉ để đếm vài cột. Chặn trần theo đúng khoảng
    // bucketTimeline thực sự dùng.
    let timelineWhere = where;
    if (!filterDto.startDate && !filterDto.endDate) {
      const tr = filterDto.timeRange;
      if (!tr || tr === 'ALL') {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - (tr === 'ALL' ? 13 : 2));
        timelineWhere = { AND: [where, { createdAt: { gte: cutoff } }] };
      }
    }

    const [timelineRows, saleGroups, categoryGroups, priceStatRows] =
      await Promise.all([
        this.prisma.quoteRequest.findMany({
          where: timelineWhere,
          select: { createdAt: true, status: true },
        }),
        this.prisma.quoteRequest.groupBy({
          by: ['requesterId', 'status'],
          where,
          _count: { _all: true },
        }),
        this.prisma.quoteRequest.groupBy({
          by: ['categoryId'],
          where,
          _count: { _all: true },
        }),
        this.prisma.quoteRequest.findMany({
          where,
          select: { finalOptionId: true, finalPrice: true },
        }),
      ]);

    const timeline = bucketTimeline(
      timelineRows,
      filterDto.timeRange || 'THIS_MONTH',
    );

    // saleStats — top 8
    const saleTotals = new Map<string, { total: number; closed: number }>();
    for (const g of saleGroups) {
      const cur = saleTotals.get(g.requesterId) || { total: 0, closed: 0 };
      cur.total += g._count._all;
      if (g.status === QuoteStatus.CLOSED) cur.closed += g._count._all;
      saleTotals.set(g.requesterId, cur);
    }
    const saleIds = [...saleTotals.keys()];
    const saleUsers = saleIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: saleIds } },
          select: { id: true, name: true },
        })
      : [];
    const saleNameById = new Map(saleUsers.map((u) => [u.id, u.name]));
    const saleStats = saleIds
      .map((id) => ({
        id,
        name: saleNameById.get(id) || 'Chưa rõ',
        total: saleTotals.get(id)!.total,
        closed: saleTotals.get(id)!.closed,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    // categoryDistribution — top 8
    const categoryIds = categoryGroups
      .map((g) => g.categoryId)
      .filter((id): id is string => !!id);
    const categories = categoryIds.length
      ? await this.prisma.productCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true },
        })
      : [];
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const categoryDistribution = categoryGroups
      .map((g) => ({
        name:
          (g.categoryId && categoryNameById.get(g.categoryId)) ||
          'Chưa phân loại',
        value: g._count._all,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // materialDistribution + featuredProducts — dùng finalOptionId (phương án đại diện đúng nghiệp vụ)
    const finalOptionIds = priceStatRows
      .map((r) => r.finalOptionId)
      .filter((id): id is string => !!id);

    const [optionMaterials, featuredOptions] = await Promise.all([
      finalOptionIds.length
        ? this.prisma.quoteOptionMaterial.findMany({
            where: { optionId: { in: finalOptionIds } },
            select: { optionId: true, material: { select: { name: true } } },
          })
        : Promise.resolve([]),
      finalOptionIds.length
        ? this.prisma.quoteOption.findMany({
            // Chỉ lấy option ĐÃ có giá — bỏ option nháp (quotedPrice null, vẫn có thể là
            // finalOptionId nếu quote_request đó chưa ai báo giá). Không lọc thì option nháp
            // (quotedDate null) bị Postgres xếp LÊN ĐẦU khi orderBy desc (NULLS FIRST mặc định),
            // chiếm hết top 4 "nổi bật" và hiện toàn "---".
            where: { id: { in: finalOptionIds }, quotedPrice: { not: null } },
            orderBy: { quotedDate: 'desc' },
            take: 4,
            select: {
              id: true,
              quotedPrice: true,
              quoteRequest: {
                select: {
                  id: true,
                  category: { select: { name: true } },
                  images: {
                    select: { id: true, imageUrl: true },
                    orderBy: { id: 'asc' },
                  },
                },
              },
              materials: { select: { material: { select: { name: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);

    const materialsByOption = new Map<string, string[]>();
    for (const row of optionMaterials) {
      const arr = materialsByOption.get(row.optionId) || [];
      arr.push(row.material.name);
      materialsByOption.set(row.optionId, arr);
    }
    const materialMap = new Map<string, number>();
    for (const row of priceStatRows) {
      const names = row.finalOptionId
        ? materialsByOption.get(row.finalOptionId)
        : undefined;
      const effective = names && names.length > 0 ? names : ['Chưa rõ'];
      for (const name of effective)
        materialMap.set(name, (materialMap.get(name) || 0) + 1);
    }
    const materialDistribution = [...materialMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const priceRangeDistribution = bucketPriceRange(
      priceStatRows.map((r) => Number(r.finalPrice || 0)),
    );

    const featuredProducts = featuredOptions.map((o: any) => {
      const matNames = o.materials.map((m: any) => m.material.name);
      const catName = o.quoteRequest.category?.name || '';
      return {
        key: `${o.quoteRequest.id}:${o.id}`,
        productName:
          `${catName} ${matNames.join(', ')}`.trim() || 'Sản phẩm chế tác',
        price: Number(o.quotedPrice || 0),
        images: o.quoteRequest.images,
      };
    });

    return {
      timeline,
      saleStats,
      categoryDistribution,
      materialDistribution,
      priceRangeDistribution,
      featuredProducts,
    };
  }

  /**
   * Hiệu suất Sale (tổng đơn/đã chốt/tỷ lệ chốt, TẤT CẢ sale active — không cắt top 8 như
   * Dashboard) + hiệu suất người báo giá (thời gian TB báo giá/xử lý). Dùng finalOptionId cho
   * quotedDate — cùng nguyên tắc đã áp dụng ở getDashboardCharts.
   */
  async getStaffPerformance() {
    const [saleGroups, saleUsers, pricerRows, pricerUsers] = await Promise.all([
      this.prisma.quoteRequest.groupBy({
        by: ['requesterId', 'status'],
        where: { requester: { role: Role.SALE, isActive: true } },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: { role: Role.SALE, isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.quoteRequest.findMany({
        where: {
          assignee: { role: Role.ORDER, isActive: true },
          acceptedAt: { not: null },
        },
        select: {
          assigneeId: true,
          acceptedAt: true,
          returnedAt: true,
          status: true,
          updatedAt: true,
          finalOptionId: true,
        },
      }),
      this.prisma.user.findMany({
        where: { role: Role.ORDER, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

    const saleTotals = new Map<string, { total: number; closed: number }>();
    for (const g of saleGroups) {
      const cur = saleTotals.get(g.requesterId) || { total: 0, closed: 0 };
      cur.total += g._count._all;
      if (g.status === QuoteStatus.CLOSED) cur.closed += g._count._all;
      saleTotals.set(g.requesterId, cur);
    }
    const saleStats = saleUsers
      .map((u) => {
        const t = saleTotals.get(u.id) || { total: 0, closed: 0 };
        return {
          id: u.id,
          name: u.name,
          total: t.total,
          closed: t.closed,
          closeRate: t.total > 0 ? (t.closed / t.total) * 100 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);

    const optionIds = pricerRows
      .map((r) => r.finalOptionId)
      .filter((id): id is string => !!id);
    const optionDates = optionIds.length
      ? await this.prisma.quoteOption.findMany({
          where: { id: { in: optionIds } },
          select: { id: true, quotedDate: true },
        })
      : [];
    const quotedDateByOptionId = new Map(
      optionDates.map((o) => [o.id, o.quotedDate]),
    );

    const handledCountByAssignee = new Map<string, number>();
    const durationsByAssignee = new Map<
      string,
      { quote: number[]; process: number[] }
    >();
    for (const r of pricerRows) {
      if (!r.assigneeId || !r.acceptedAt) continue;
      handledCountByAssignee.set(
        r.assigneeId,
        (handledCountByAssignee.get(r.assigneeId) || 0) + 1,
      );
      const acceptedMs = new Date(r.acceptedAt).getTime();
      const quotedDate = r.finalOptionId
        ? quotedDateByOptionId.get(r.finalOptionId)
        : null;
      const bucket = durationsByAssignee.get(r.assigneeId) || {
        quote: [],
        process: [],
      };
      if (quotedDate) {
        const dur = new Date(quotedDate).getTime() - acceptedMs;
        if (dur >= 0) {
          bucket.quote.push(dur);
          bucket.process.push(dur);
        }
      } else if (r.returnedAt) {
        const dur = new Date(r.returnedAt).getTime() - acceptedMs;
        if (dur >= 0) bucket.process.push(dur);
      } else if (r.status === QuoteStatus.REJECTED && r.updatedAt) {
        const dur = new Date(r.updatedAt).getTime() - acceptedMs;
        if (dur >= 0) bucket.process.push(dur);
      }
      durationsByAssignee.set(r.assigneeId, bucket);
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const pricerStats = pricerUsers
      .map((u) => {
        const b = durationsByAssignee.get(u.id) || { quote: [], process: [] };
        return {
          id: u.id,
          name: u.name,
          totalHandled: handledCountByAssignee.get(u.id) || 0,
          avgQuoteMs: avg(b.quote),
          avgProcessMs: avg(b.process),
        };
      })
      .sort((a, b) => b.totalHandled - a.totalHandled);

    return { saleStats, pricerStats };
  }
}
