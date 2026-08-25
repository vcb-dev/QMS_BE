import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { UpdateQuoteRequestDto } from './dto/update-quote-request.dto';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { ExportQuoteRequestDto } from './dto/export-quote-request.dto';
import { QuoteStatus, User, Role } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { QuoteQueryService } from './quote-query.service';
import { QuoteWorkflowService } from './quote-workflow.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ExcelService } from '../excel/excel.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LarkNotificationService } from '../lark/lark-notification.service';
import { QuoteOptionsService } from './quote-options.service';
import { EXPORT_FIELD_DEFS } from './dto/export-field-defs';
import {
  REQUEST_DETAIL_INCLUDE,
  buildOptionCreateInput,
  mapQuoteRequestDetail,
} from '../utils/option-mapper.util';

@Injectable()
export class QuoteRequestsService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
    private queryService: QuoteQueryService,
    private workflowService: QuoteWorkflowService,
    private auditLog: AuditLogService,
    private excelService: ExcelService,
    private realtimeGateway: RealtimeGateway,
    private larkService: LarkNotificationService,
    private quoteOptionsService: QuoteOptionsService,
  ) {}

  private generateCode(): string {
    const year = new Date().getFullYear();
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    return `QG-${year}-${randomSeq}`;
  }

  async create(
    userId: string,
    dto: CreateQuoteRequestDto,
    files?: Express.Multer.File[],
  ) {
    this.queryService.clearCache();
    const {
      imageUrls,
      materialIds,
      materialId,
      stoneIds,
      newCategoryName,
      productName,
      options,
      ...data
    } = dto;
    const code = this.generateCode();

    const fallbackMaterials = (
      materialIds?.length ? materialIds : materialId ? [materialId] : []
    ).map((mId) => ({ materialId: mId }));

    const fallbackStones = (stoneIds?.length ? stoneIds : []).map((sId) => ({
      stoneId: sId,
      quantity: 1,
    }));

    let finalCategoryId = data.categoryId;
    if (newCategoryName && newCategoryName.trim()) {
      const existing = await this.prisma.productCategory.findFirst({
        where: {
          name: { equals: newCategoryName.trim(), mode: 'insensitive' },
        },
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

    const hasRealOptions = options && options.length > 0;
    // Sale không tự nhập tiền công/VAT (quote-options.controller.ts CHỦ ĐỘNG ẩn 2 field này khỏi
    // response trả về cho Sale — Sale chỉ được xem Giá bán). Nên dù Sale tạo yêu cầu qua máy tính
    // giá (gửi kèm `options`) hay tạo nhanh không qua máy tính (không gửi `options`), option lưu
    // xuống DB đều có thể thiếu laborCost/vat — luôn tra sẵn danh mục sản phẩm để bù vào chỗ thiếu.
    const categoryDefaults = finalCategoryId
      ? await this.prisma.productCategory.findUnique({
          where: { id: finalCategoryId },
          select: { laborCost: true, vatRate: true },
        })
      : null;
    const defaultLaborCost =
      categoryDefaults?.laborCost != null
        ? Number(categoryDefaults.laborCost)
        : undefined;
    const defaultVat =
      categoryDefaults?.vatRate != null
        ? Number(categoryDefaults.vatRate)
        : undefined;

    const effectiveOptions: any[] = hasRealOptions
      ? options.map((opt) => ({
          ...opt,
          laborCost: opt.laborCost != null ? opt.laborCost : defaultLaborCost,
          vat: opt.vat != null ? opt.vat : defaultVat,
          materials:
            opt.materials && opt.materials.length > 0
              ? opt.materials
              : fallbackMaterials.length > 0
                ? fallbackMaterials
                : undefined,
          stones:
            opt.stones && opt.stones.length > 0
              ? opt.stones
              : fallbackStones.length > 0
                ? fallbackStones
                : undefined,
        }))
      : fallbackMaterials.length > 0 || fallbackStones.length > 0
        ? [
            {
              optionName: 'Yêu cầu ban đầu',
              laborCost: defaultLaborCost,
              vat: defaultVat,
              materials:
                fallbackMaterials.length > 0 ? fallbackMaterials : undefined,
              stones: fallbackStones.length > 0 ? fallbackStones : undefined,
            },
          ]
        : [];

    const stonePriceMap =
      await this.quoteOptionsService.buildStonePriceMap(effectiveOptions);
    const optionsCreate =
      effectiveOptions.length > 0
        ? {
            create: effectiveOptions.map((opt, idx) =>
              buildOptionCreateInput(opt, idx, dto.categoryId, stonePriceMap),
            ),
          }
        : undefined;

    const finalCloudinaryUrls: string[] = [];
    if (files && files.length > 0) {
      const uploadedResults =
        await this.cloudinaryService.uploadMultipleImages(files);
      finalCloudinaryUrls.push(...uploadedResults.map((r) => r.url));
    }

    if (imageUrls && imageUrls.length > 0) {
      const uploadedFromDto = await Promise.all(
        imageUrls.map((url) => this.cloudinaryService.uploadBase64OrUrl(url)),
      );
      finalCloudinaryUrls.push(...uploadedFromDto.filter(Boolean));
    }

    const created = await this.prisma.quoteRequest.create({
      data: {
        ...data,
        categoryId: finalCategoryId,
        code,
        status: QuoteStatus.PENDING,
        version: 1,
        requesterId: userId,
        images:
          finalCloudinaryUrls.length > 0
            ? {
                create: finalCloudinaryUrls.map((url) => ({ imageUrl: url })),
              }
            : undefined,
        options: optionsCreate,
      },
      include: REQUEST_DETAIL_INCLUDE,
    });

    await this.auditLog.logActionByUserId(userId, 'CREATE_QUOTE', created.id);
    const detail = mapQuoteRequestDetail(created);
    this.realtimeGateway.broadcastStatusChanged(created.id, created.status);
    this.larkService.notifyOrder(
      `📋 Yêu cầu báo giá mới: ${created.code} (${(created as any).category?.name || 'Sản phẩm chế tác'}) — người tạo: ${(created as any).requester?.name || 'Sale'}`,
      created.id,
    );
    return detail;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateQuoteRequestDto,
    files?: Express.Multer.File[],
  ) {
    this.queryService.clearCache();
    // materialIds/materialId/options không còn map trực tiếp vào QuoteRequest — chất liệu/option
    // sửa qua action riêng (QUOTE/QUICK_QUOTE) ở QuoteWorkflowService, không qua update() chung này.
    const { imageUrls, materialIds, materialId, options, ...data } = dto;

    const finalCloudinaryUrls: string[] = [];
    if (files && files.length > 0) {
      const uploadedResults =
        await this.cloudinaryService.uploadMultipleImages(files);
      finalCloudinaryUrls.push(...uploadedResults.map((r) => r.url));
    }

    if (imageUrls && imageUrls.length > 0) {
      const uploadedFromDto = await Promise.all(
        imageUrls.map((url) => this.cloudinaryService.uploadBase64OrUrl(url)),
      );
      finalCloudinaryUrls.push(...uploadedFromDto.filter(Boolean));
    }

    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        ...data,
        images:
          finalCloudinaryUrls.length > 0
            ? {
                deleteMany: {},
                create: finalCloudinaryUrls.map((url) => ({ imageUrl: url })),
              }
            : undefined,
      },
      include: REQUEST_DETAIL_INCLUDE,
    });

    await this.auditLog.logActionByUserId(userId, 'UPDATE_QUOTE', id);
    return mapQuoteRequestDetail(updated);
  }

  async remove(id: string, userId: string) {
    this.queryService.clearCache();
    await this.auditLog.logActionByUserId(userId, 'DELETE_QUOTE', id);
    await this.prisma.quoteRequest.delete({ where: { id } });
    this.realtimeGateway.broadcastStatusChanged(id, 'DELETED');
    return { message: 'Đã hủy yêu cầu báo giá thành công' };
  }

  async updateStatus(
    id: string,
    userId: string,
    role: Role,
    dto: UpdateQuoteStatusDto,
  ) {
    const result = await this.workflowService.updateStatus(
      id,
      userId,
      role,
      dto,
    );
    this.realtimeGateway.broadcastStatusChanged(result.id, result.status);
    return result;
  }

  async deleteOption(id: string, optionId: string, userId: string, role: Role) {
    const res = await this.workflowService.deleteOption(
      id,
      optionId,
      userId,
      role,
    );
    this.realtimeGateway.broadcastStatusChanged(id, 'OPTION_DELETED');
    return res;
  }

  /**
   * Export danh sách yêu cầu báo giá ra Excel (.xlsx) theo bộ lọc hiện có + chọn cột tùy ý.
   * dto.fields rỗng/không truyền = export toàn bộ cột trong EXPORT_FIELD_DEFS.
   */
  async exportToExcel(dto: ExportQuoteRequestDto, user: User): Promise<Buffer> {
    const requestedKeys = dto.fields
      ?.split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    const fieldDefs = requestedKeys?.length
      ? EXPORT_FIELD_DEFS.filter((f) => requestedKeys.includes(f.key))
      : EXPORT_FIELD_DEFS;

    if (requestedKeys?.length) {
      const validKeys = new Set(EXPORT_FIELD_DEFS.map((f) => f.key));
      const invalidKeys = requestedKeys.filter((k) => !validKeys.has(k));
      if (invalidKeys.length > 0) {
        throw new BadRequestException(
          `Cột export không hợp lệ: ${invalidKeys.join(', ')}`,
        );
      }
    }

    const items = await this.queryService.findAllForExport(dto, user);

    const rows = items.map((item) => {
      const row: Record<string, unknown> = {};
      for (const field of fieldDefs) {
        row[field.key] = field.value(item);
      }
      return row;
    });

    return this.excelService.exportToBuffer(
      'Yêu cầu báo giá',
      fieldDefs.map((f) => ({ key: f.key, header: f.header })),
      rows,
    );
  }
}
