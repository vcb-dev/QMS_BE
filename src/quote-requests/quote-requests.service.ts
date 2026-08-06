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
import { QuoteOptionItemDto } from './dto/quote-complete.dto';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { UpdateQuoteStatusDto, QuoteAction } from './dto/update-quote-status.dto';
import { QuoteStatus, User, Role } from '@prisma/client';

type CompleteQuoteInput = {
  quotedPrice: number;
  vat?: number;
  options?: QuoteOptionItemDto[];
};

@Injectable()
export class QuoteRequestsService {
  private readonly listCache = new Map<string, { at: number; data: any }>();
  private readonly cacheTtlMs = 30_000;

  constructor(private prisma: PrismaService) {}

  private clearCache() {
    this.listCache.clear();
  }

  private generateCode(): string {
    const year = new Date().getFullYear();
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    return `QG-${year}-${randomSeq}`;
  }

  async create(userId: string, dto: CreateQuoteRequestDto) {
    this.clearCache();
    const { imageUrls, materialIds, materialId, ...data } = dto;
    const code = this.generateCode();

    const connectMaterials = materialIds && materialIds.length > 0
      ? { connect: materialIds.map((id) => ({ id })) }
      : materialId
      ? { connect: [{ id: materialId }] }
      : undefined;

    return this.prisma.quoteRequest.create({
      data: {
        ...data,
        code,
        status: QuoteStatus.YC_MOI,
        version: 1,
        requesterId: userId,
        createdById: userId,
        materialId: materialId || (materialIds && materialIds[0]) || undefined,
        materials: connectMaterials,
        images: imageUrls && imageUrls.length > 0
          ? {
              create: imageUrls.map((url) => ({ imageUrl: url })),
            }
          : undefined,
      },
      include: {
        customer: true,
        material: true,
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async findAll(filterDto: FilterQuoteRequestDto, _user: User) {
    const { status, search, requesterId, pricerId, page = 1, limit = 100 } = filterDto;
    const skip = (page - 1) * limit;
    const cacheKey = JSON.stringify({ status, search, requesterId, pricerId, page, limit });
    this.listCache.clear();

    const where: any = {};

    if (requesterId) {
      where.requesterId = requesterId;
    }

    if (status) {
      where.status = status;
    }

    if (pricerId) {
      where.pricerId = pricerId;
    }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { productName: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const items = await this.prisma.quoteRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        material: true,
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });

    const result = {
      data: items,
      meta: {
        total: items.length,
        page,
        limit,
        totalPages: 1,
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
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }
    return quote;
  }

  async update(id: string, userId: string, dto: UpdateQuoteRequestDto) {
    this.clearCache();
    const { imageUrls, materialIds, materialId, ...data } = dto;

    const setMaterials = materialIds
      ? { set: materialIds.map((matId) => ({ id: matId })) }
      : undefined;

    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        ...data,
        materialId: materialId || (materialIds && materialIds[0]) || undefined,
        materials: setMaterials,
        images: imageUrls
          ? {
              deleteMany: {},
              create: imageUrls.map((url) => ({ imageUrl: url })),
            }
          : undefined,
      },
      include: {
        customer: true,
        material: true,
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
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
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
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

    // Reset all options to unselected
    await this.prisma.quoteOption.updateMany({
      where: { quoteRequestId: id },
      data: { isSelected: false },
    });

    // Mark target option as selected
    await this.prisma.quoteOption.update({
      where: { id: optionId },
      data: { isSelected: true },
    });

    // Update QuoteRequest main price to selected option's price
    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        quotedPrice: option.quotedPrice,
        selectedOptionId: option.id,
      },
      include: {
        customer: true,
        material: true,
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
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
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
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
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
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
        materials: true,
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  // Unified Status Update (1 single PATCH /status endpoint)
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

