import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { LibraryProductsQueryDto } from './dto/library-products-query.dto';
import { QuoteStatus, User, Role, Prisma } from '@prisma/client';
import { APP_CONSTANTS } from '../common/constants';
import {
  REQUEST_DETAIL_INCLUDE,
  OPTION_SUMMARY_SELECT,
  mapQuoteRequestDetail,
  pickPrimaryOption,
  buildProductName,
} from '../utils/option-mapper.util';
import { buildQuoteWhereClause } from '../utils/quote-filter.util';
import {
  countsFromGroupBy,
  getMyReqCount,
  primaryOptionPrice,
} from '../utils/quote-counts.util';
import {
  bucketTimeline,
  bucketPriceRange,
} from '../utils/dashboard-stats.util';
import { QuoteOptionsService, LivePriceItem } from './quote-options.service';

@Injectable()
export class QuoteQueryService {
  private readonly listCache = new Map<string, { at: number; data: any }>();
  private readonly cacheTtlMs = 30_000;

  constructor(
    private prisma: PrismaService,
    private quoteOptionsService: QuoteOptionsService,
  ) {}

  clearCache() {
    this.listCache.clear();
  }

  /**
   * Aggregated stats only (counts + revenue sums) — no item rows fetched.
   * Dùng cho % thay đổi kỳ trước & KPI, thay vì kéo cả list rồi tính tay ở FE.
   */
  async getStats(filterDto: FilterQuoteRequestDto, _user: User) {
    const where = buildQuoteWhereClause(filterDto, _user);

    const [groupByRes, myReqCnt, revenueRows] = await Promise.all([
      this.prisma.quoteRequest.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      getMyReqCount(this.prisma, _user),
      this.prisma.quoteRequest.findMany({
        where: {
          ...where,
          status: { in: [QuoteStatus.QUOTED, QuoteStatus.CLOSED] },
        },
        select: {
          status: true,
          options: {
            select: { quotedPrice: true, selectionStatus: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
    ]);

    const counts = countsFromGroupBy(groupByRes, myReqCnt);

    let closedRevenue = 0;
    let quotedRevenue = 0;
    for (const row of revenueRows) {
      const price = primaryOptionPrice(row);
      if (row.status === QuoteStatus.CLOSED) closedRevenue += price;
      else if (row.status === QuoteStatus.QUOTED) quotedRevenue += price;
    }

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

    const [timelineRows, saleGroups, categoryGroups, priceStatRows] =
      await Promise.all([
        this.prisma.quoteRequest.findMany({
          where,
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
            where: { id: { in: finalOptionIds } },
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

  /**
   * Danh sách sản phẩm đã báo giá (Thư viện/Quản lý sản phẩm) — gộp trùng theo dedupKey, sort +
   * phân trang thật ở SQL. Bước 1 dùng raw SQL lấy đúng option_id đại diện mỗi nhóm trùng + tổng
   * số lần trùng + phân trang; bước 2 hydrate chi tiết (materials/stones/images) bằng Prisma cho
   * ĐÚNG các option_id của trang hiện tại (nhỏ, không kéo toàn bộ).
   */
  async getLibraryProducts(dto: LibraryProductsQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 8;
    const offset = (page - 1) * limit;
    const search = dto.search?.trim();

    const filters: Prisma.Sql[] = [
      Prisma.sql`qo.quoted_price IS NOT NULL`,
      Prisma.sql`qr.status IN ('QUOTED', 'CLOSED')`,
      Prisma.sql`qo.dedup_key IS NOT NULL`,
    ];
    if (dto.categoryId && dto.categoryId !== 'ALL') {
      filters.push(Prisma.sql`qr.category_id = ${dto.categoryId}`);
    }
    if (dto.materialId && dto.materialId !== 'ALL') {
      filters.push(
        Prisma.sql`EXISTS (SELECT 1 FROM quote_option_materials qom WHERE qom.option_id = qo.id AND qom.material_id = ${dto.materialId})`,
      );
    }
    if (search) {
      filters.push(Prisma.sql`(
        qr.code ILIKE ${`%${search}%`}
        OR pc.name ILIKE ${`%${search}%`}
        OR EXISTS (
          SELECT 1 FROM quote_option_materials qom2
          JOIN materials m ON m.id = qom2.material_id
          WHERE qom2.option_id = qo.id AND m.name ILIKE ${`%${search}%`}
        )
      )`);
    }
    const cutoff = this.libraryTimeRangeCutoff(dto.timeRange);
    if (cutoff) {
      filters.push(
        Prisma.sql`COALESCE(qo.quoted_date, qr.created_at) >= ${cutoff}`,
      );
    }
    const whereSql = Prisma.join(filters, ' AND ');

    const sortSql =
      dto.sortMode === 'PRICE_ASC'
        ? Prisma.sql`quoted_price ASC, option_id`
        : dto.sortMode === 'MOST_QUOTED'
          ? Prisma.sql`duplicate_count DESC, option_id`
          : dto.sortMode === 'RECENT'
            ? Prisma.sql`COALESCE(quoted_date, request_created_at) DESC, option_id`
            : Prisma.sql`quoted_price DESC, option_id`;

    const cteSql = Prisma.sql`
      WITH candidates AS (
        SELECT qo.id AS option_id, qo.dedup_key, qo.quoted_price, qo.quoted_date,
               qr.id AS request_id, qr.created_at AS request_created_at
        FROM quote_options qo
        JOIN quote_requests qr ON qr.id = qo.quote_request_id
        LEFT JOIN product_categories pc ON pc.id = qr.category_id
        WHERE ${whereSql}
      ),
      deduped AS (
        SELECT DISTINCT ON (dedup_key) *,
          COUNT(*) OVER (PARTITION BY dedup_key) AS duplicate_count
        FROM candidates
        ORDER BY dedup_key, COALESCE(quoted_date, request_created_at) DESC
      )
      SELECT option_id, duplicate_count, quoted_price, quoted_date, request_created_at
      FROM deduped
    `;

    const [pageRows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<{ option_id: string; duplicate_count: number }[]>(
        Prisma.sql`
        ${cteSql} ORDER BY ${sortSql} LIMIT ${limit} OFFSET ${offset}
      `,
      ),
      this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM (${cteSql}) t
      `),
    ]);
    const total = Number(totalRows[0]?.count || 0);

    const duplicateCountByOptionId = new Map(
      pageRows.map((r) => [r.option_id, Number(r.duplicate_count)]),
    );
    const optionIds = pageRows.map((r) => r.option_id);

    const options = optionIds.length
      ? await this.prisma.quoteOption.findMany({
          where: { id: { in: optionIds } },
          select: {
            ...OPTION_SUMMARY_SELECT,
            quoteRequest: {
              select: {
                id: true,
                code: true,
                categoryId: true,
                createdAt: true,
                category: { select: { name: true } },
                images: {
                  select: { id: true, imageUrl: true },
                  orderBy: { id: 'asc' },
                },
              },
            },
          },
        })
      : [];

    if (dto.withLivePrice === 'true') {
      await this.attachLivePricesToOptions(options as any[]);
    }

    const optionById = new Map(options.map((o: any) => [o.id, o]));
    const data = pageRows
      .map((row) => optionById.get(row.option_id))
      .filter((o): o is any => !!o)
      .map((o: any) => {
        const catName = o.quoteRequest.category?.name || '';
        const matStr = (o.materials || [])
          .map((m: any) => m.material?.name)
          .filter(Boolean)
          .join(', ');
        const weightVal = o.weightChi;
        const weightDisplay =
          weightVal != null && Number(weightVal) > 0
            ? `${weightVal} chỉ`
            : null;

        let stoneDisplay = 'Không đính đá';
        if (o.stones && o.stones.length > 0) {
          const totalStones = o.stones.reduce(
            (sum: number, s: any) => sum + (s.quantity || 1),
            0,
          );
          const names = o.stones
            .map((s: any) => `${s.quantity}v ${s.stone?.name || 'đá'}`)
            .join(', ');
          stoneDisplay = `${totalStones} viên (${names})`;
        } else if (o.stoneDescription) {
          stoneDisplay = o.stoneDescription;
        } else if (o.stoneCost && Number(o.stoneCost) > 0) {
          stoneDisplay = `Đá trị giá ${Number(o.stoneCost).toLocaleString('vi-VN')}đ`;
        }

        return {
          key: `${o.quoteRequest.id}:${o.id}`,
          requestId: o.quoteRequest.id,
          code: o.quoteRequest.code,
          categoryId: o.quoteRequest.categoryId,
          images: o.quoteRequest.images,
          option: o,
          productName: `${catName} ${matStr}`.trim() || 'Sản phẩm chế tác',
          matStr,
          weightDisplay,
          stoneDisplay,
          materialIds: (o.materials || [])
            .map((m: any) => m.materialId)
            .filter(Boolean),
          requestCreatedAt: o.quoteRequest.createdAt,
          duplicateCount: duplicateCountByOptionId.get(o.id) || 1,
        };
      });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  private libraryTimeRangeCutoff(timeRange: string | undefined): Date | null {
    const now = new Date();
    if (timeRange === 'TODAY')
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (timeRange === 'THIS_WEEK') {
      const day = now.getDay() || 7;
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - day + 1,
      );
    }
    if (timeRange === 'THIS_MONTH')
      return new Date(now.getFullYear(), now.getMonth(), 1);
    return null;
  }

  private async attachLivePricesToOptions(options: any[]) {
    const inputs: LivePriceItem[] = [];
    for (const opt of options) {
      if (opt.quotedPrice == null) continue;
      inputs.push({
        key: opt.id,
        materials: (opt.materials || []).map((m: any) => ({
          materialId: m.materialId,
          weightChi: Number(m.weightChi) || 0,
        })),
        laborCost: Number(opt.laborCost) || 0,
        vatRate: opt.vat != null ? Number(opt.vat) : 10,
        stones:
          (opt.stones || []).length > 0
            ? opt.stones.map((s: any) => ({
                stoneId: s.stoneId,
                quantity: s.quantity,
              }))
            : undefined,
        manualStoneCost: Number(opt.stoneCost) || 0,
      });
    }
    if (inputs.length === 0) return;
    const priceMap =
      await this.quoteOptionsService.batchComputeLivePrices(inputs);
    for (const opt of options) {
      if (priceMap.has(opt.id)) opt.livePrice = priceMap.get(opt.id);
    }
  }

  async findAll(filterDto: FilterQuoteRequestDto, _user: User) {
    const cacheKey = JSON.stringify({
      filterDto,
      userId: _user?.id,
      role: _user?.role,
    });
    // withLivePrice=true là nút "Tải lại giá" bấm tay — phải luôn tính lại giá MỚI NHẤT, cache
    // 30s ở đây sẽ trả nhầm giá cũ nếu bấm lại trong vòng 30s sau khi vừa đổi giá kim loại/đá.
    const skipCache = filterDto.withLivePrice === 'true';
    const cached = skipCache ? undefined : this.listCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.data;
    }

    const { page = 1, limit = 10 } = filterDto;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where = buildQuoteWhereClause(filterDto, _user);
    // Counts phải bỏ status filter — nếu không, groupBy chỉ còn đúng status đang chọn,
    // các ô trạng thái khác trên UI sẽ hiện 0 hết.
    const countsWhere = buildQuoteWhereClause(
      { ...filterDto, status: undefined },
      _user,
    );

    const countsPromise = Promise.all([
      this.prisma.quoteRequest.groupBy({
        by: ['status'],
        where: countsWhere,
        _count: { _all: true },
      }),
      getMyReqCount(this.prisma, _user),
    ]).then(([res, myReqCnt]) => countsFromGroupBy(res, myReqCnt));

    // Dashboard fetch 500 dòng chỉ để vẽ biểu đồ/thống kê — không cần customer/assignee/options
    // (quan hệ nặng nhất, không dùng tới), bỏ luôn cho nhẹ query.
    const isLite = filterDto.lite === 'true';

    const [items, total, counts] = await Promise.all([
      this.prisma.quoteRequest.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          desiredLeadTime: true,
          customerMeasurements: true,
          closeRatePct: true,
          status: true,
          rejectReason: true,
          returnReason: true,
          acceptedAt: true,
          returnedAt: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          customerId: true,
          categoryId: true,
          requesterId: true,
          assigneeId: true,
          category: { select: { id: true, name: true, vatRate: true } },
          requester: {
            select: {
              id: true,
              name: true,
              email: true,
              department: { select: { id: true, name: true } },
            },
          },
          images: {
            select: { id: true, imageUrl: true },
            orderBy: { id: 'asc' },
          },
          ...(isLite
            ? {
                // Lấy option MỚI NHẤT (không phải cũ nhất) — option đầu tiên luôn là bản nháp
                // rỗng "Yêu cầu ban đầu", lấy createdAt asc + take:1 sẽ luôn ra option chưa có giá.
                options: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: OPTION_SUMMARY_SELECT,
                },
              }
            : {
                options: {
                  orderBy: { createdAt: 'asc' },
                  select: OPTION_SUMMARY_SELECT,
                },
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    address: true,
                    province: true,
                    ward: true,
                  },
                },
                assignee: { select: { id: true, name: true, email: true } },
              }),
        },
      }),
      this.prisma.quoteRequest.count({ where }),
      countsPromise,
    ]);

    if (items.length === 0) {
      return {
        data: [],
        meta: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
          counts,
        },
      };
    }

    const sanitizedItems = items.map((item: any) => this.sanitizeItem(item));

    if (filterDto.withLivePrice === 'true' && !isLite) {
      // Phải tính giá sống TRƯỚC khi ẩn field giá vốn — attachLivePrices cần đọc laborCost/
      // stoneCost của chính option đó để tính lại giá, ẩn trước thì Sale mở Thư Viện Sản Phẩm sẽ
      // luôn ra null.
      await this.attachLivePrices(sanitizedItems);
    }

    // Sale chỉ được xem Giá bán — không được thấy cấu thành giá (giá vốn kim loại/tiền công/giá
    // đá), giống chính sách đã áp dụng ở quote-options.controller cho luồng tính giá. Ẩn ở tầng
    // service (không phải chỉ FE) vì đây là dữ liệu nghiệp vụ nhạy cảm nhất hệ thống.
    if (_user?.role === Role.SALE) {
      for (const item of sanitizedItems) {
        item.options = this.stripCostFieldsForSale(item.options);
      }
    }

    const totalPages = Math.ceil(total / limitNum) || 1;

    const result = {
      data: sanitizedItems,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        counts,
      },
    };

    if (!skipCache) {
      this.listCache.set(cacheKey, { at: Date.now(), data: result });
    }
    return result;
  }

  // Gắn giá "sống" (livePrice) vào từng option — tính theo config HIỆN TẠI (giá kim loại/đá/tỷ lệ/
  // VAT hôm nay), không đụng quotedPrice đã đóng băng. 1 lệnh gọi cho cả trang, 0 query DB thêm
  // (batchComputeLivePrices tự lấy giá kim loại/chất liệu/đá từ cache TTL sẵn có).
  private async attachLivePrices(items: any[]) {
    const inputs: LivePriceItem[] = [];
    for (const item of items) {
      const categoryVat =
        item.category?.vatRate != null ? Number(item.category.vatRate) : null;
      for (const opt of item.options || []) {
        if (opt.quotedPrice == null) continue;
        inputs.push({
          key: opt.id,
          materials: (opt.materials || []).map((m: any) => ({
            materialId: m.materialId,
            weightChi: Number(m.weightChi) || 0,
          })),
          laborCost: Number(opt.laborCost) || 0,
          vatRate: categoryVat ?? (opt.vat != null ? Number(opt.vat) : 10),
          stones:
            (opt.stones || []).length > 0
              ? opt.stones.map((s: any) => ({
                  stoneId: s.stoneId,
                  quantity: s.quantity,
                }))
              : undefined,
          manualStoneCost: Number(opt.stoneCost) || 0,
        });
      }
    }
    if (inputs.length === 0) return;
    // Batch tính giá sống cho cả trang, tránh query DB nhiều lần (1 option = 1 query) — batchComputeLivePrices
    const priceMap =
      await this.quoteOptionsService.batchComputeLivePrices(inputs);
    for (const item of items) {
      for (const opt of item.options || []) {
        if (priceMap.has(opt.id)) opt.livePrice = priceMap.get(opt.id);
      }
    }
  }

  // Cắt field cấu thành giá vốn khỏi từng option — Sale chỉ được xem quotedPrice (giá bán), không
  // được thấy laborCost/stoneCost/totalMetalCost/metalRawCost/stonePrice. Public vì
  // QuoteWorkflowService (accept/markClosed/selectOption/resubmit...) cũng trả trực tiếp
  // mapQuoteRequestDetail() cho các action Sale được phép gọi, cần lọc lại y hệt ở đây.
  stripCostFieldsForSale(options: any[] | undefined) {
    if (!options) return options;
    return options.map((opt: any) => {
      const {
        laborCost,
        stoneCost,
        totalMetalCost,
        metalRawCost,
        stonePrice,
        ...rest
      } = opt;
      return rest;
    });
  }

  private sanitizeItem(item: any) {
    const primaryOption = pickPrimaryOption(item);
    const matArr = (primaryOption?.materials || []).map((m: any) => m.material);
    const dynamicProductName = buildProductName(
      item.category?.name,
      matArr.map((m: any) => m.name),
    );

    return {
      ...item,
      productName: dynamicProductName,
      material: matArr[0] || null,
      materials: matArr,
      quotedPrice: primaryOption?.quotedPrice ?? null,
      vat: primaryOption?.vat ?? null,
      quotedDate: primaryOption?.quotedDate ?? null,
      images: (item.images || []).map((img: any) => ({
        ...img,
        imageUrl: img.imageUrl.startsWith('data:image')
          ? 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=500&auto=format&fit=crop&q=60'
          : img.imageUrl,
      })),
    };
  }

  /**
   * Lấy toàn bộ danh sách theo bộ lọc (không phân trang, không cache) — dùng cho export Excel.
   * Chặn trần MAX_EXPORT_ROWS để tránh kéo quá nhiều dòng cùng lúc.
   */
  async findAllForExport(filterDto: FilterQuoteRequestDto, user: User) {
    const where = buildQuoteWhereClause(filterDto, user);

    const items = await this.prisma.quoteRequest.findMany({
      where,
      take: APP_CONSTANTS.MAX_EXPORT_ROWS,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        desiredLeadTime: true,
        customerMeasurements: true,
        closeRatePct: true,
        status: true,
        rejectReason: true,
        returnReason: true,
        acceptedAt: true,
        returnedAt: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
            department: { select: { id: true, name: true } },
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            address: true,
            province: true,
            ward: true,
          },
        },
        assignee: { select: { id: true, name: true, email: true } },
        images: { select: { id: true, imageUrl: true }, take: 1 },
        options: {
          orderBy: { createdAt: 'asc' },
          select: {
            quotedPrice: true,
            vat: true,
            quotedDate: true,
            selectionStatus: true,
            materials: {
              select: { material: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    return items.map((item: any) => this.sanitizeItem(item));
  }

  async findOne(idOrCode: string, role?: Role) {
    const quote = await this.prisma.quoteRequest.findFirst({
      where: {
        OR: [{ id: idOrCode }, { code: idOrCode }],
      },
      include: REQUEST_DETAIL_INCLUDE,
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    const mapped = mapQuoteRequestDetail(quote);
    // Sale chỉ được xem Giá bán — không được thấy cấu thành giá vốn (xem thêm comment ở findAll).
    if (role === Role.SALE) {
      mapped.options = this.stripCostFieldsForSale(mapped.options);
    }

    const primaryOption = pickPrimaryOption(mapped);
    const matArr = primaryOption?.materials || [];
    const dynamicProductName = buildProductName(
      mapped.category?.name,
      matArr.map((m: any) => m.materialName),
    );

    return {
      ...mapped,
      material: matArr[0]
        ? { id: matArr[0].materialId, name: matArr[0].materialName }
        : null,
      productName: dynamicProductName,
      // QuoteRequest không có cột quotedPrice riêng (giá nằm ở QuoteOption) — bổ sung field cấp
      // ngoài cho FE, khớp với findAll(). Thiếu field này khiến F5 trực tiếp trang chi tiết luôn
      // hiện "Chưa có giá chốt" dù đã có phương án báo giá thật.
      quotedPrice: primaryOption?.quotedPrice ?? null,
      vat: primaryOption?.vat ?? null,
      quotedDate: primaryOption?.quotedDate ?? null,
    };
  }
}
