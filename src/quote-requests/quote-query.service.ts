import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { QuoteStatus, User, Role } from '@prisma/client';

@Injectable()
export class QuoteQueryService {
  private readonly listCache = new Map<string, { at: number; data: any }>();
  private readonly cacheTtlMs = 30_000;

  constructor(private prisma: PrismaService) {}

  clearCache() {
    this.listCache.clear();
  }

  async findAll(filterDto: FilterQuoteRequestDto, _user: User) {
    const cacheKey = JSON.stringify({ filterDto, userId: _user?.id, role: _user?.role });
    const cached = this.listCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.data;
    }

    const {
      status,
      search,
      requesterId,
      pricerId,
      categoryId,
      materialId,
      ownerId,
      startDate,
      endDate,
      timeRange,
      page = 1,
      limit = 10,
    } = filterDto;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const andConditions: any[] = [];

    const targetOwner = ownerId || requesterId;
    if (targetOwner) {
      if (_user?.role === Role.PRICING) {
        andConditions.push({ pricerId: targetOwner });
      } else {
        andConditions.push({ requesterId: targetOwner });
      }
    }

    if (status && Object.values(QuoteStatus).includes(status as any)) {
      andConditions.push({ status: status as QuoteStatus });
    }

    if (pricerId) {
      andConditions.push({ pricerId });
    }

    if (categoryId && categoryId !== 'ALL') {
      andConditions.push({ categoryId });
    }

    if (materialId && materialId !== 'ALL') {
      andConditions.push({
        OR: [
          { materialId: materialId },
          { materials: { some: { materialId: materialId } } },
        ],
      });
    }

    if (search && search.trim() !== '') {
      const trimmed = search.trim();
      andConditions.push({
        OR: [
          { code: { contains: trimmed, mode: 'insensitive' } },
          { category: { name: { contains: trimmed, mode: 'insensitive' } } },
          { customer: { name: { contains: trimmed, mode: 'insensitive' } } },
          { customer: { phone: { contains: trimmed, mode: 'insensitive' } } },
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
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            break;
          case 'THIS_WEEK': {
            const day = now.getDay() || 7;
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
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

    const where = andConditions.length > 0 ? { AND: andConditions } : {};

    const myReqCountPromise = _user?.id
      ? this.prisma.quoteRequest.count({
          where: _user.role === Role.PRICING
            ? { pricerId: _user.id }
            : { requesterId: _user.id },
        })
      : Promise.resolve(0);

    const countsPromise = Promise.all([
      this.prisma.quoteRequest.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      myReqCountPromise,
    ]).then(([res, myReqCnt]) => {
      const map: Record<string, number> = {
        total: 0,
        myReq: myReqCnt,
        ycMoi: 0,
        dangXly: 0,
        needMoreInfo: 0,
        xong: 0,
        tuChoi: 0,
      };
      for (const item of res) {
        const cnt = item._count._all;
        map.total += cnt;
        if (item.status === QuoteStatus.YC_MOI) map.ycMoi = cnt;
        else if (item.status === QuoteStatus.DANG_XLY) map.dangXly = cnt;
        else if (item.status === QuoteStatus.NEED_MORE_INFO) map.needMoreInfo = cnt;
        else if (item.status === QuoteStatus.XONG) map.xong = cnt;
        else if (item.status === QuoteStatus.TU_CHOI) map.tuChoi = cnt;
      }
      return map;
    });

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
          vat: true,
          quotedPrice: true,
          quotedDate: true,
          status: true,
          rejectReason: true,
          returnReason: true,
          selectedOptionId: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          customerId: true,
          materialId: true,
          categoryId: true,
          requesterId: true,
          pricerId: true,
        },
      }),
      this.prisma.quoteRequest.count({ where }),
      countsPromise,
    ]);

    if (items.length === 0) {
      return {
        data: [],
        meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) || 1, counts },
      };
    }

    const customerIds = [...new Set(items.map((i) => i.customerId))];
    const materialIds = [...new Set(items.map((i) => i.materialId).filter(Boolean))] as string[];
    const categoryIds = [...new Set(items.map((i) => i.categoryId))];
    const requesterIds = [...new Set(items.map((i) => i.requesterId))];
    const pricerIds = [...new Set(items.map((i) => i.pricerId).filter(Boolean))] as string[];
    const quoteRequestIds = items.map((i) => i.id);

    const [
      customers,
      materials,
      categories,
      requesters,
      pricers,
      quoteMaterials,
      images,
    ] = await Promise.all([
      this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true, phone: true, address: true, province: true, ward: true },
      }),
      materialIds.length
        ? this.prisma.material.findMany({
            where: { id: { in: materialIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      this.prisma.productCategory.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: requesterIds } },
        select: {
          id: true,
          name: true,
          email: true,
          department: { select: { id: true, name: true } },
        },
      }),
      pricerIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: pricerIds } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
      this.prisma.quoteRequestMaterial.findMany({
        where: { quoteRequestId: { in: quoteRequestIds } },
        select: {
          quoteRequestId: true,
          material: { select: { id: true, name: true } },
        },
      }),
      this.prisma.quoteRequestImage.findMany({
        where: { quoteRequestId: { in: quoteRequestIds } },
        select: { id: true, imageUrl: true, quoteRequestId: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const customerMap = new Map(customers.map((c): [string, typeof c] => [c.id, c]));
    const materialMap = new Map(materials.map((m): [string, typeof m] => [m.id, m]));
    const categoryMap = new Map(categories.map((c): [string, typeof c] => [c.id, c]));
    const requesterMap = new Map(requesters.map((r): [string, typeof r] => [r.id, r]));
    const pricerMap = new Map(pricers.map((p): [string, typeof p] => [p.id, p]));

    const materialsByQuoteId = new Map<string, { id: string; name: string }[]>();
    for (const qm of quoteMaterials) {
      if (!materialsByQuoteId.has(qm.quoteRequestId)) {
        materialsByQuoteId.set(qm.quoteRequestId, []);
      }
      materialsByQuoteId.get(qm.quoteRequestId)!.push(qm.material);
    }

    const imagesByQuoteId = new Map<string, { id: string; imageUrl: string }[]>();
    for (const img of images) {
      if (!imagesByQuoteId.has(img.quoteRequestId)) {
        imagesByQuoteId.set(img.quoteRequestId, []);
      }
      const arr = imagesByQuoteId.get(img.quoteRequestId)!;
      if (arr.length === 0) arr.push({ id: img.id, imageUrl: img.imageUrl });
    }

    const sanitizedItems = items.map((item) => {
      const catName = categoryMap.get(item.categoryId)?.name || '';
      const matArr = materialsByQuoteId.get(item.id) || [];
      const matName = matArr.length > 0
        ? matArr.map((m) => m.name).join(', ')
        : (item.materialId ? materialMap.get(item.materialId)?.name : '') || '';
      const dynamicProductName = `${catName} ${matName}`.trim() || 'Sản phẩm chế tác';

      return {
        ...item,
        productName: dynamicProductName,
        customer: customerMap.get(item.customerId) || null,
        material: item.materialId ? materialMap.get(item.materialId) || null : null,
        category: categoryMap.get(item.categoryId) || null,
        requester: requesterMap.get(item.requesterId) || null,
        pricer: item.pricerId ? pricerMap.get(item.pricerId) || null : null,
        materials: matArr,
        images: (imagesByQuoteId.get(item.id) || []).map((img) => ({
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

  async findOne(id: string) {
    const quote = await this.prisma.quoteRequest.findUnique({
      where: { id },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: true,
      },
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    if (quote.options && Array.isArray(quote.options)) {
      quote.options.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    const catName = quote.category?.name || '';
    const matNames = quote.materials && quote.materials.length > 0
      ? quote.materials.map((m) => m.material.name).join(', ')
      : quote.material?.name || '';
    const dynamicProductName = `${catName} ${matNames}`.trim() || 'Sản phẩm chế tác';

    return {
      ...quote,
      productName: dynamicProductName,
    };
  }
}
