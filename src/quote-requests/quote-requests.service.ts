import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { UpdateQuoteRequestDto } from './dto/update-quote-request.dto';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { ExportQuoteRequestDto } from './dto/export-quote-request.dto';
import { QuoteStatus, User, Role } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { QuoteQueryService } from './quote/quote-query.service';
import { QuoteWorkflowService } from './quote/quote-workflow.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ExcelService } from '../excel/excel.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { QuoteOptionsService } from './quote-option/quote-options.service';
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
    private quoteOptionsService: QuoteOptionsService,
  ) {}

  private generateCode(): string {
    const year = new Date().getFullYear();
    const randomSeq = Math.floor(1000 + Math.random() * 9000);
    return `QG-${year}-${randomSeq}`;
  }

  // Sale không khai báo khách (bỏ trống ô tìm khách) thì gom hết vào 1 khách chung "Khách lẻ" —
  // KHÔNG đẻ ra bản ghi khách mới mỗi lần tạo yêu cầu. Bản ghi "Khách lẻ" tạo đúng 1 lần rồi
  // dùng lại mãi.
  private static readonly WALK_IN_CUSTOMER_NAME = 'Khách lẻ';

  private async resolveWalkInCustomerId(customerId?: string): Promise<string> {
    const trimmed = customerId?.trim();
    if (trimmed) return trimmed;

    const name = QuoteRequestsService.WALK_IN_CUSTOMER_NAME;
    const existing = await this.prisma.customer.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.customer.create({ data: { name } });
    return created.id;
  }

  async create(
    userId: string,
    dto: CreateQuoteRequestDto,
    files?: Express.Multer.File[],
    videoFile?: Express.Multer.File,
  ) {
    this.queryService.clearCache();
    const {
      imageUrls,
      videoUrl,
      materialIds,
      materialId,
      stoneIds,
      newCategoryName,
      productName,
      options,
      customerId,
      ...data
    } = dto;
    const code = this.generateCode();
    const finalCustomerId = await this.resolveWalkInCustomerId(customerId);

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

    const lookups =
      await this.quoteOptionsService.buildOptionLookupMaps(effectiveOptions);
    const optionsCreate =
      effectiveOptions.length > 0
        ? {
            create: effectiveOptions.map((opt, idx) =>
              buildOptionCreateInput(
                opt,
                idx,
                dto.categoryId,
                lookups.stonePriceMap,
                lookups,
              ),
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

    let finalVideoUrl: string | undefined;
    if (videoFile) {
      const uploadedVideo = await this.cloudinaryService.uploadVideo(videoFile);
      finalVideoUrl = uploadedVideo.url;
    } else if (videoUrl && videoUrl.startsWith('http')) {
      finalVideoUrl = videoUrl;
    }

    const created = await this.prisma.quoteRequest.create({
      data: {
        ...data,
        customerId: finalCustomerId,
        categoryId: finalCategoryId,
        code,
        status: QuoteStatus.PENDING,
        version: 1,
        requesterId: userId,
        videoUrl: finalVideoUrl,
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
    return detail;
  }

  async update(
    id: string,
    userId: string,
    role: Role,
    dto: UpdateQuoteRequestDto,
    files?: Express.Multer.File[],
    videoFile?: Express.Multer.File,
  ) {
    this.queryService.clearCache();
    const existing = await this.prisma.quoteRequest.findUnique({
      where: { id },
      include: { requester: true },
    });
    if (!existing) {
      throw new BadRequestException('Yêu cầu báo giá không tồn tại');
    }
    if (userId !== existing.requesterId && role !== Role.ADMIN) {
      throw new BadRequestException(
        'Bạn không có quyền chỉnh sửa yêu cầu báo giá này',
      );
    }
    if (
      existing.status === QuoteStatus.CLOSED ||
      existing.status === QuoteStatus.REJECTED
    ) {
      throw new BadRequestException(
        'Yêu cầu báo giá đã đóng hoặc bị từ chối, không thể chỉnh sửa',
      );
    }
    // materialIds/materialId/options không còn map trực tiếp vào QuoteRequest — chất liệu/option
    // sửa qua action riêng (QUOTE/QUICK_QUOTE) ở QuoteWorkflowService, không qua update() chung này.
    const { imageUrls, videoUrl, materialIds, materialId, options, ...data } =
      dto;

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

    // Video: file mới chọn -> upload thật; không có file nhưng có videoUrl (giữ video cũ) -> giữ
    // nguyên; cả 2 đều không có (Sale xóa video) -> gán null để xóa hẳn video cũ khỏi request.
    let finalVideoUrl: string | null | undefined;
    if (videoFile) {
      const uploadedVideo = await this.cloudinaryService.uploadVideo(videoFile);
      finalVideoUrl = uploadedVideo.url;
    } else if (videoUrl && videoUrl.startsWith('http')) {
      finalVideoUrl = videoUrl;
    } else {
      finalVideoUrl = null;
    }

    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        ...data,
        videoUrl: finalVideoUrl,
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
