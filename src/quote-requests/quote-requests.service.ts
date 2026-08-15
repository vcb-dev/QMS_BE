import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { UpdateQuoteRequestDto } from './dto/update-quote-request.dto';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { QuickQuoteSubmitDto } from './dto/quick-quote.dto';
import { QuoteStatus, User, Role } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { QuoteQueryService } from './quote-query.service';
import { QuoteWorkflowService } from './quote-workflow.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class QuoteRequestsService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
    private queryService: QuoteQueryService,
    private workflowService: QuoteWorkflowService,
    private auditLog: AuditLogService,
  ) {}

  private async logAction(userId: string, action: string, entityId?: string, entityType: string = 'QuoteRequest') {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
    if (!user) return;
    await this.auditLog.log({
      actorId: userId,
      actorName: user.name,
      actorRole: user.role,
      action,
      entityType,
      entityId,
    });
  }

  private generateCode(): string {
    const year = new Date().getFullYear();
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    return `QG-${year}-${randomSeq}`;
  }

  async create(userId: string, dto: CreateQuoteRequestDto, files?: Express.Multer.File[]) {
    this.queryService.clearCache();
    const { imageUrls, materialIds, materialId, newCategoryName, productName, quotedPrice, options, ...data } = dto;
    const code = this.generateCode();

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

    const created = await this.prisma.quoteRequest.create({
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

    await this.logAction(userId, 'CREATE_QUOTE', created.id);
    return created;
  }

  async submitQuickQuote(userId: string, dto: QuickQuoteSubmitDto) {
    this.queryService.clearCache();
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
      await this.logAction(userId, 'CREATE_CUSTOMER', createdCust.id, 'Customer');
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
      await this.logAction(userId, 'QUICK_SUBMIT_QUOTE', quoteRequestId);
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
    const created = await this.prisma.quoteRequest.create({
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

    await this.logAction(userId, 'QUICK_SUBMIT_QUOTE', created.id);
    return created;
  }

  async findAll(filterDto: FilterQuoteRequestDto, user: User) {
    return this.queryService.findAll(filterDto, user);
  }

  async findOne(id: string) {
    return this.queryService.findOne(id);
  }

  async update(id: string, userId: string, dto: UpdateQuoteRequestDto, files?: Express.Multer.File[]) {
    this.queryService.clearCache();
    const { imageUrls, materialIds, materialId, options, ...data } = dto;

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

    const updated = await this.prisma.quoteRequest.update({
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

    await this.logAction(userId, 'UPDATE_QUOTE', id);
    return updated;
  }

  async remove(id: string, userId: string) {
    this.queryService.clearCache();
    await this.logAction(userId, 'DELETE_QUOTE', id);
    await this.prisma.quoteRequest.delete({ where: { id } });
    return { message: 'Đã hủy yêu cầu báo giá thành công' };
  }

  async updateStatus(id: string, userId: string, role: Role, dto: UpdateQuoteStatusDto) {
    return this.workflowService.updateStatus(id, userId, role, dto);
  }
}
