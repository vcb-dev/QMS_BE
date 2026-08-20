import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { QuoteStatus, User, Role } from '@prisma/client';
import { APP_CONSTANTS } from '../common/constants';
import {
  REQUEST_DETAIL_INCLUDE,
  mapQuoteRequestDetail,
  pickPrimaryOption,
} from './utils/option-mapper.util';

// Tên chất liệu trong DB nhúng sẵn tỉ lệ vàng (VD: "Vàng 14K (58.5%)") để hiển thị ở dropdown chọn
// chất liệu — nhưng ghép vào productName tự sinh thì thừa/rối, nên cắt phần "(xx.x%)" ra ở đây.
function stripMaterialPercent(name: string): string {
  return name.replace(/\s*\(\d+(\.\d+)?%\)/g, '').trim();
}

@Injectable()
export class QuoteQueryService {
  private readonly listCache = new Map<string, { at: number; data: any }>();
  private readonly cacheTtlMs = 30_000;

  constructor(private prisma: PrismaService) {}

  clearCache() {
    this.listCache.clear();
  }

  private buildWhereClause(filterDto: FilterQuoteRequestDto, _user: User) {
    const {
      status,
      search,
      requesterId,
      assigneeId,
      categoryId,
      materialId,
      ownerId,
      startDate,
      endDate,
      timeRange,
    } = filterDto;

    const andConditions: any[] = [];

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
      const trimmed = search.trim();
      const matchedStatuses = Object.entries(APP_CONSTANTS.QUOTE_STATUS_LABELS)
        .filter(([, label]) =>
          label.toLowerCase().includes(trimmed.toLowerCase()),
        )
        .map(([value]) => value as QuoteStatus);

      andConditions.push({
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
                    material: {
                      name: { contains: trimmed, mode: 'insensitive' },
                    },
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
          ...(matchedStatuses.length
            ? [{ status: { in: matchedStatuses } }]
            : []),
        ],
      });
    }

    if (timeRange || startDate || endDate) {
      let start: Date | undefined;
      let end: Date | undefined;

      if (startDate) {
        start = new Date(startDate);
      }
      if (endDate) {
        end = new Date(endDate);
      }

      if (timeRange && !start) {
        const now = new Date();
        switch (timeRange) {
          case 'TODAY':
            start = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
              0,
              0,
              0,
            );
            end = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate(),
              23,
              59,
              59,
            );
            break;
          case 'THIS_WEEK': {
            const day = now.getDay() || 7;
            start = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate() - day + 1,
              0,
              0,
              0,
            );
            break;
          }
          case 'LAST_WEEK': {
            const day = now.getDay() || 7;
            const thisMonday = new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate() - day + 1,
              0,
              0,
              0,
            );
            start = new Date(
              thisMonday.getFullYear(),
              thisMonday.getMonth(),
              thisMonday.getDate() - 7,
              0,
              0,
              0,
            );
            end = new Date(
              thisMonday.getFullYear(),
              thisMonday.getMonth(),
              thisMonday.getDate() - 1,
              23,
              59,
              59,
            );
            break;
          }
          case 'THIS_MONTH':
            start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
            break;
          case 'LAST_MONTH':
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            break;
          case 'THIS_YEAR':
            start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
            break;
          case 'ALL':
          default:
            break;
        }
      }

      const createdAtFilter: any = {};
      if (start) createdAtFilter.gte = start;
      if (end) createdAtFilter.lte = end;
      if (Object.keys(createdAtFilter).length > 0) {
        andConditions.push({ createdAt: createdAtFilter });
      }
    }

    return andConditions.length > 0 ? { AND: andConditions } : {};
  }

  private myReqCountPromise(user: User) {
    if (!user?.id) return Promise.resolve(0);
    return this.prisma.quoteRequest.count({
      where:
        user.role === Role.ORDER
          ? { assigneeId: user.id }
          : { requesterId: user.id },
    });
  }

  private countsFromGroupBy(
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
      else if (item.status === QuoteStatus.NEED_MORE_INFO)
        map.needMoreInfo = cnt;
      else if (item.status === QuoteStatus.QUOTED) map.quoted = cnt;
      else if (item.status === QuoteStatus.REJECTED) map.rejected = cnt;
      else if (item.status === QuoteStatus.CLOSED) map.closed = cnt;
    }
    return map;
  }

  // Giá đại diện của 1 request cho mục đích thống kê/hiển thị nhanh — dùng chung logic với
  // pickPrimaryOption (ưu tiên option CLOSED, rồi SELECTED, rồi option có giá mới nhất).
  // quotedPrice không còn ở QuoteRequest nên không thể groupBy._sum trực tiếp như trước,
  // phải tự cộng ở app layer.
  private primaryOptionPrice(row: { options?: any[] }): number {
    const price = pickPrimaryOption(row)?.quotedPrice;
    return Number(price || 0);
  }

  /**
   * Aggregated stats only (counts + revenue sums) — no item rows fetched.
   * Dùng cho % thay đổi kỳ trước & KPI, thay vì kéo cả list rồi tính tay ở FE.
   */
  async getStats(filterDto: FilterQuoteRequestDto, _user: User) {
    const where = this.buildWhereClause(filterDto, _user);

    const [groupByRes, myReqCnt, revenueRows] = await Promise.all([
      this.prisma.quoteRequest.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.myReqCountPromise(_user),
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

    const counts = this.countsFromGroupBy(groupByRes, myReqCnt);

    let closedRevenue = 0;
    let quotedRevenue = 0;
    for (const row of revenueRows) {
      const price = this.primaryOptionPrice(row);
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

  async findAll(filterDto: FilterQuoteRequestDto, _user: User) {
    const cacheKey = JSON.stringify({
      filterDto,
      userId: _user?.id,
      role: _user?.role,
    });
    const cached = this.listCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.data;
    }

    const { page = 1, limit = 10 } = filterDto;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where = this.buildWhereClause(filterDto, _user);
    // Counts phải bỏ status filter — nếu không, groupBy chỉ còn đúng status đang chọn,
    // các ô trạng thái khác trên UI sẽ hiện 0 hết.
    const countsWhere = this.buildWhereClause(
      { ...filterDto, status: undefined },
      _user,
    );

    const countsPromise = Promise.all([
      this.prisma.quoteRequest.groupBy({
        by: ['status'],
        where: countsWhere,
        _count: { _all: true },
      }),
      this.myReqCountPromise(_user),
    ]).then(([res, myReqCnt]) => this.countsFromGroupBy(res, myReqCnt));

    // Dashboard fetch 500 dòng chỉ để vẽ biểu đồ/thống kê — không cần customer/assignee/options
    // (quan hệ nặng nhất, không dùng tới), bỏ luôn cho nhẹ query.
    const isLite = filterDto.lite === 'true';

    const optionSummarySelect = {
      id: true,
      quotedPrice: true,
      vat: true,
      quotedDate: true,
      weightChi: true,
      laborCost: true,
      stoneCost: true,
      totalMetalCost: true,
      metalRawCost: true,
      stonePrice: true,
      selectionStatus: true,
      materials: {
        select: {
          materialId: true,
          weightChi: true,
          material: { select: { id: true, name: true } },
        },
      },
      stones: {
        select: {
          stoneId: true,
          quantity: true,
          stone: { select: { id: true, name: true, stoneType: true } },
        },
      },
    } as const;

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
          category: { select: { id: true, name: true } },
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
            take: 1,
          },
          ...(isLite
            ? {
                // Lấy option MỚI NHẤT (không phải cũ nhất) — option đầu tiên luôn là bản nháp
                // rỗng "Yêu cầu ban đầu", lấy createdAt asc + take:1 sẽ luôn ra option chưa có giá.
                options: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: optionSummarySelect,
                },
              }
            : {
                options: {
                  orderBy: { createdAt: 'asc' },
                  select: optionSummarySelect,
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

    const sanitizedItems = items.map((item: any) => {
      const catName = item.category?.name || '';
      const primaryOption = pickPrimaryOption(item);
      const matArr = (primaryOption?.materials || []).map(
        (m: any) => m.material,
      );
      const matName = matArr
        .map((m: any) => stripMaterialPercent(m.name))
        .join(', ');
      const dynamicProductName =
        `${catName} ${matName}`.trim() || 'Sản phẩm chế tác';

      return {
        ...item,
        productName: dynamicProductName,
        material: matArr[0] || null,
        materials: matArr,
        quotedPrice: primaryOption?.quotedPrice ?? null,
        vat: primaryOption?.vat ?? null,
        quotedDate: primaryOption?.quotedDate ?? null,
        images: item.images.map((img: any) => ({
          ...img,
          imageUrl: img.imageUrl.startsWith('data:image')
            ? 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=500&auto=format&fit=crop&q=60'
            : img.imageUrl,
        })),
      };
    });

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

    this.listCache.set(cacheKey, { at: Date.now(), data: result });
    return result;
  }

  async findOne(idOrCode: string) {
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

    const catName = mapped.category?.name || '';
    const primaryOption = pickPrimaryOption(mapped);
    const matArr = primaryOption?.materials || [];
    const matNames = matArr
      .map((m: any) => stripMaterialPercent(m.materialName))
      .join(', ');
    const dynamicProductName =
      `${catName} ${matNames}`.trim() || 'Sản phẩm chế tác';

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
