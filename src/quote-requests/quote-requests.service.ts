import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { UpdateQuoteRequestDto } from './dto/update-quote-request.dto';
import { QuoteOptionItemDto, CompleteQuoteInput } from './dto/quote-complete.dto';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { UpdateQuoteStatusDto, QuoteAction } from './dto/update-quote-status.dto';
import { QuickQuoteSubmitDto } from './dto/quick-quote.dto';
import { QuoteStatus, User, Role } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class QuoteRequestsService {
  private readonly listCache = new Map<string, { at: number; data: any }>();
  private readonly cacheTtlMs = 30_000;

  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
  ) {}

  private clearCache() {
    this.listCache.clear();
  }

  private generateCode(): string {
    const year = new Date().getFullYear();
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    return `QG-${year}-${randomSeq}`;
  }

  async create(userId: string, dto: CreateQuoteRequestDto, files?: Express.Multer.File[]) {
    this.clearCache();
    const { imageUrls, materialIds, materialId, newCategoryName, productName, quotedPrice, ...data } = dto;
    const code = this.generateCode();

    let finalCategoryId = data.categoryId;
    if (newCategoryName && newCategoryName.trim()) {
      const existing = await this.prisma.productCategory.findFirst({
        where: { name: { equals: newCategoryName.trim(), mode: 'insensitive' } },
      });
      if (existing) {
        finalCategoryId = existing.id;
      } else {
        const createdCat = await this.prisma.productCategory.create({
          data: { name: newCategoryName.trim() },
        });
        finalCategoryId = createdCat.id;
      }
    }

    let finalCloudinaryUrls: string[] = [];
    if (files && files.length > 0) {
      const uploadedResults = await this.cloudinaryService.uploadMultipleImages(files);
      finalCloudinaryUrls.push(...uploadedResults.map((r) => r.url));
    }

    if (imageUrls && imageUrls.length > 0) {
      const uploadedFromDto = await Promise.all(
        imageUrls.map((url) => this.cloudinaryService.uploadBase64OrUrl(url)),
      );
      finalCloudinaryUrls.push(...uploadedFromDto.filter(Boolean));
    }

    const connectMaterials = materialIds && materialIds.length > 0
      ? { create: materialIds.map((id) => ({ materialId: id })) }
      : materialId
      ? { create: [{ materialId: materialId }] }
      : undefined;

    return this.prisma.quoteRequest.create({
      data: {
        ...data,
        categoryId: finalCategoryId,
        code,
        quotedPrice: quotedPrice || undefined,
        status: QuoteStatus.YC_MOI,
        version: 1,
        requesterId: userId,
        materialId: materialId || (materialIds && materialIds[0]) || undefined,
        materials: connectMaterials,
        images: finalCloudinaryUrls.length > 0
          ? {
              create: finalCloudinaryUrls.map((url) => ({ imageUrl: url })),
            }
          : undefined,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async submitQuickQuote(userId: string, dto: QuickQuoteSubmitDto) {
    this.clearCache();
    const { quoteRequestId, productName, categoryId, materialId, customerId, newCustomer, pricerId, options, quotedPrice, vat } = dto;

    let finalCustomerId = customerId;
    if (!finalCustomerId && newCustomer) {
      const createdCust = await this.prisma.customer.create({
        data: {
          name: newCustomer.name,
          phone: newCustomer.phone || null,
          address: newCustomer.address || null,
          province: newCustomer.province || '',
          ward: newCustomer.ward || '',
          note: newCustomer.note || null,
        },
      });
      finalCustomerId = createdCust.id;
    }

    if (!finalCustomerId) {
      throw new BadRequestException('Vui lòng chọn khách hàng có sẵn hoặc nhập thông tin khách hàng mới');
    }

    const optionsCreate = options && options.length > 0
      ? {
          create: options.map((opt, idx) => ({
            optionName: opt.optionName || `Phương án ${idx + 1}`,
            materialName: opt.materialName,
            weightChi: opt.weightChi,
            laborCost: opt.laborCost,
            stoneCost: opt.stoneCost,
            stoneDescription: opt.stoneDescription,
            vat: opt.vat,
            quotedPrice: opt.quotedPrice,
            isSelected: opt.isSelected ?? (idx === 0),
            note: opt.note,
          })),
        }
      : undefined;

    if (quoteRequestId) {
      if (options && options.length > 0) {
        await this.prisma.quoteOption.deleteMany({ where: { quoteRequestId } });
      }
      return this.prisma.quoteRequest.update({
        where: { id: quoteRequestId },
        data: {
          categoryId,
          customerId: finalCustomerId,
          materialId: materialId || undefined,
          pricerId: pricerId || undefined,
          status: QuoteStatus.DANG_XLY,
          quotedPrice: quotedPrice || (options && options[0] ? options[0].quotedPrice : undefined),
          vat: vat ?? 0,
          options: optionsCreate,
        },
        include: {
          customer: true,
          material: true,
          materials: { include: { material: true } },
          category: true,
          requester: { select: { id: true, name: true, email: true, department: true } },
          pricer: { select: { id: true, name: true, email: true } },
          images: true,
          options: { orderBy: { createdAt: 'asc' } },
        },
      });
    }

    const code = this.generateCode();
    return this.prisma.quoteRequest.create({
      data: {
        code,
        status: QuoteStatus.DANG_XLY,
        requesterId: userId,
        customerId: finalCustomerId,
        categoryId,
        materialId: materialId || undefined,
        pricerId: pricerId || undefined,
        vat: vat ?? 0,
        quotedPrice: quotedPrice || (options && options[0] ? options[0].quotedPrice : undefined),
        materials: materialId ? { create: [{ materialId }] } : undefined,
        options: optionsCreate,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
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
        select: { id: true, name: true, phone: true, address: true },
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

  async update(id: string, userId: string, dto: UpdateQuoteRequestDto, files?: Express.Multer.File[]) {
    this.clearCache();
    const { imageUrls, materialIds, materialId, ...data } = dto;

    let finalCloudinaryUrls: string[] = [];
    if (files && files.length > 0) {
      const uploadedResults = await this.cloudinaryService.uploadMultipleImages(files);
      finalCloudinaryUrls.push(...uploadedResults.map((r) => r.url));
    }

    if (imageUrls && imageUrls.length > 0) {
      const uploadedFromDto = await Promise.all(
        imageUrls.map((url) => this.cloudinaryService.uploadBase64OrUrl(url)),
      );
      finalCloudinaryUrls.push(...uploadedFromDto.filter(Boolean));
    }

    const setMaterials = materialIds
      ? {
          deleteMany: {},
          create: materialIds.map((matId) => ({ materialId: matId })),
        }
      : undefined;

    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        ...data,
        materialId: materialId || (materialIds && materialIds[0]) || undefined,
        materials: setMaterials,
        images: finalCloudinaryUrls.length > 0
          ? {
              deleteMany: {},
              create: finalCloudinaryUrls.map((url) => ({ imageUrl: url })),
            }
          : undefined,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async remove(id: string, userId: string) {
    this.clearCache();
    await this.prisma.quoteRequest.delete({ where: { id } });
    return { message: 'Đã hủy yêu cầu báo giá thành công' };
  }

  private async accept(id: string, userId: string) {
    this.clearCache();
    const result = await this.prisma.quoteRequest.updateMany({
      where: { id, status: QuoteStatus.YC_MOI },
      data: {
        status: QuoteStatus.DANG_XLY,
        pricerId: userId,
        version: { increment: 1 },
      },
    });

    if (result.count !== 1) {
      throw new ConflictException('Yêu cầu này đã được tiếp nhận bởi nhân sự khác');
    }

    return this.findOne(id);
  }

  private async assertPricingCanProcess(
    id: string,
    userId: string,
    role: Role,
  ) {
    const quote = await this.prisma.quoteRequest.findUnique({
      where: { id },
      select: { status: true, pricerId: true },
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    if (quote.status !== QuoteStatus.DANG_XLY) {
      throw new ConflictException('Yêu cầu phải đang được xử lý trước khi thực hiện thao tác này');
    }

    if (role === Role.PRICING && quote.pricerId !== userId) {
      throw new ForbiddenException('Bạn chỉ được thao tác trên yêu cầu do mình tiếp nhận xử lý');
    }
  }

  private async completeQuote(id: string, userId: string, dto: CompleteQuoteInput) {
    this.clearCache();

    if (dto.options && dto.options.length > 0) {
      await this.prisma.quoteOption.deleteMany({ where: { quoteRequestId: id } });
    }

    const optionsCreate = dto.options && dto.options.length > 0
      ? {
          create: dto.options.map((opt, idx) => ({
            optionName: opt.optionName || `Phương án ${idx + 1}`,
            materialName: opt.materialName,
            weightChi: opt.weightChi,
            laborCost: opt.laborCost,
            stoneCost: opt.stoneCost,
            stoneDescription: opt.stoneDescription,
            vat: opt.vat,
            quotedPrice: opt.quotedPrice,
            isSelected: opt.isSelected ?? (idx === 0),
            note: opt.note,
          })),
        }
      : undefined;

    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        vat: dto.vat ?? 0,
        quotedPrice: dto.quotedPrice,
        quotedDate: new Date(),
        pricerId: userId,
        status: QuoteStatus.XONG,
        options: optionsCreate,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  private async selectOption(id: string, optionId: string) {
    this.clearCache();
    const option = await this.prisma.quoteOption.findUnique({
      where: { id: optionId },
    });

    if (!option || option.quoteRequestId !== id) {
      throw new NotFoundException('Không tìm thấy phương án báo giá tương ứng');
    }

    await this.prisma.quoteOption.updateMany({
      where: { quoteRequestId: id },
      data: { isSelected: false },
    });

    await this.prisma.quoteOption.update({
      where: { id: optionId },
      data: { isSelected: true },
    });

    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        quotedPrice: option.quotedPrice,
        selectedOptionId: option.id,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  private async rejectQuote(id: string, userId: string, rejectReason: string) {
    this.clearCache();
    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        rejectReason,
        pricerId: userId,
        status: QuoteStatus.TU_CHOI,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  private async returnQuote(id: string, userId: string, returnReason: string) {
    this.clearCache();
    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        returnReason,
        pricerId: userId,
        status: QuoteStatus.NEED_MORE_INFO,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  private async resubmitQuote(id: string) {
    this.clearCache();
    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        status: QuoteStatus.YC_MOI,
        pricerId: null,
        version: { increment: 1 },
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async updateStatus(id: string, userId: string, role: Role, dto: UpdateQuoteStatusDto) {
    switch (dto.action) {
      case QuoteAction.ACCEPT:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép tiếp nhận yêu cầu');
        }
        return this.accept(id, userId);

      case QuoteAction.QUOTE:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép báo giá');
        }
        if (!dto.quotedPrice) {
          throw new BadRequestException('Vui lòng nhập giá sản phẩm (quotedPrice)');
        }
        await this.assertPricingCanProcess(id, userId, role);
        return this.completeQuote(id, userId, {
          quotedPrice: dto.quotedPrice,
          vat: dto.vat,
          options: dto.options,
        });

      case QuoteAction.QUICK_QUOTE:
        this.clearCache();
        return this.prisma.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteStatus.DANG_XLY,
            ...(dto.quotedPrice ? { quotedPrice: dto.quotedPrice } : {}),
          },
          include: {
            customer: true,
            material: true,
            materials: { include: { material: true } },
            category: true,
            requester: { select: { id: true, name: true, email: true, department: true } },
            pricer: { select: { id: true, name: true, email: true } },
            images: true,
            options: { orderBy: { createdAt: 'asc' } },
          },
        });

      case QuoteAction.QUICK_APPROVE:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép duyệt báo giá nhanh');
        }
        this.clearCache();
        return this.prisma.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteStatus.XONG,
            pricerId: userId,
            quotedDate: new Date(),
            ...(dto.quotedPrice ? { quotedPrice: dto.quotedPrice } : {}),
          },
          include: {
            customer: true,
            material: true,
            materials: { include: { material: true } },
            category: true,
            requester: { select: { id: true, name: true, email: true, department: true } },
            pricer: { select: { id: true, name: true, email: true } },
            images: true,
            options: { orderBy: { createdAt: 'asc' } },
          },
        });

      case QuoteAction.QUICK_REJECT:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép từ chối báo giá nhanh');
        }
        this.clearCache();
        return this.rejectQuote(id, userId, dto.rejectReason || 'Không đồng ý với báo giá nhanh này');

      case QuoteAction.REJECT:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép từ chối yêu cầu');
        }
        if (!dto.rejectReason) {
          throw new BadRequestException('Vui lòng nhập lý do từ chối (rejectReason)');
        }
        await this.assertPricingCanProcess(id, userId, role);
        return this.rejectQuote(id, userId, dto.rejectReason);

      case QuoteAction.RETURN:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép trả lại yêu cầu');
        }
        if (!dto.returnReason) {
          throw new BadRequestException('Vui lòng nhập lý do cần bổ sung (returnReason)');
        }
        await this.assertPricingCanProcess(id, userId, role);
        return this.returnQuote(id, userId, dto.returnReason);

      case QuoteAction.RESUBMIT:
        if (role !== Role.SALE && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò SALE hoặc ADMIN mới được phép gửi lại yêu cầu');
        }
        return this.resubmitQuote(id);

      case QuoteAction.SELECT_OPTION:
        if (role !== Role.SALE && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò SALE hoặc ADMIN mới được phép chọn phương án báo giá');
        }
        if (!dto.optionId) {
          throw new BadRequestException('Vui lòng chọn ID phương án (optionId)');
        }
        return this.selectOption(id, dto.optionId);

      default:
        throw new BadRequestException('Hành động chuyển trạng thái không hợp lệ');
    }
  }
}
