import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { QuoteOptionsService } from './quote-options.service';
import {
  CalculateMultiInput,
  CalculatePriceInput,
} from './dto/calculate-price.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

// Máy tính giá dùng lúc Sale/Order soạn phương án báo giá (trước khi lưu) — khác batchComputeLivePrices
// (tính lại giá cho option ĐÃ LƯU, không qua HTTP, gọi thẳng từ QuoteQueryService).
@UseGuards(JwtAuthGuard)
@Controller('quote-options')
export class QuoteOptionsController {
  constructor(
    private readonly quoteOptionsService: QuoteOptionsService,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  // Sale không tự nhập tiền công/VAT — luôn lấy theo danh mục sản phẩm đã chọn
  // (ProductCategory.laborCost/vatRate), Order vẫn nhập tay tự do mỗi lần báo giá.
  private async resolveSaleCategoryDefaults(
    categoryId?: string,
  ): Promise<{ laborCost: number; vatRate: number }> {
    if (!categoryId) return { laborCost: 0, vatRate: 10 };
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
      select: { laborCost: true, vatRate: true },
    });
    return {
      laborCost: category?.laborCost ? Number(category.laborCost) : 0,
      vatRate: category?.vatRate != null ? Number(category.vatRate) : 10,
    };
  }

  /** Danh sách hệ số nhân Bạc để chọn lúc báo giá — Sale cũng được xem (không lộ tỷ lệ vàng/bảng lợi nhuận) */
  @Get('silver-multipliers')
  async getSilverMultipliers() {
    const silverMultipliers =
      await this.quoteOptionsService.getSilverMultipliers();
    return { silverMultipliers };
  }

  @Post('calculate')
  async calculatePrice(
    @Body() dto: CalculatePriceInput,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: Role,
  ) {
    await this.auditLog.logAction(
      actorId,
      actorRole,
      'CALCULATE_PRICE',
      'QuoteOption',
    );

    // Sale không được tự nhập tiền công/mức VAT nữa. Cả hai lấy theo danh mục sản phẩm đã chọn.
    // Sale chỉ được chọn CÓ cộng VAT hay KHÔNG (dto.includeVat), không được tự set mức %.
    if (actorRole === Role.SALE) {
      const { laborCost, vatRate } = await this.resolveSaleCategoryDefaults(
        dto.categoryId,
      );
      dto.laborCost = laborCost;
      dto.vatRate = dto.includeVat === false ? 0 : vatRate;
      // Hệ số nhân Bạc chỉ ORDER/ADMIN được chọn — Sale luôn dùng mặc định
      dto.silverMultiplier = undefined;
    }

    const result = await this.quoteOptionsService.calculate5StepPrice(dto);

    // Sale chỉ được xem Giá bán — ẩn toàn bộ cấu thành giá (giá vốn/tiền công/giá vàng/VAT) theo spec
    if (actorRole === Role.SALE) {
      return {
        materialNameOrKey: result.materialNameOrKey,
        quotedPrice: result.quotedPrice,
      };
    }

    return result;
  }

  @Post('calculate-multi')
  async calculateMultiPrice(
    @Body() dto: CalculateMultiInput,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: Role,
  ) {
    await this.auditLog.logAction(
      actorId,
      actorRole,
      'CALCULATE_MULTI_MATERIAL_PRICE',
      'QuoteOption',
    );

    if (actorRole === Role.SALE) {
      const { laborCost, vatRate } = await this.resolveSaleCategoryDefaults(
        dto.categoryId,
      );
      dto.laborCost = laborCost;
      dto.vatRate = dto.includeVat === false ? 0 : vatRate;
    }

    const result = await this.quoteOptionsService.calculateMulti(dto);
    if (actorRole === Role.SALE) {
      return {
        quotedPrice: result.quotedPrice,
      };
    }
    return result;
  }

  @Post('generate-options')
  async generateOptions(
    @Body() dto: any,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: Role,
  ) {
    await this.auditLog.logAction(
      actorId,
      actorRole,
      'GENERATE_PRICING_OPTIONS',
      'QuoteOption',
    );

    // Sale không tự nhập tiền công/mức VAT. Cả hai lấy theo danh mục sản phẩm đã chọn.
    // Sale chỉ chọn CÓ/KHÔNG cộng VAT (dto.includeVat do Sale gửi lên).
    if (actorRole === Role.SALE) {
      const { laborCost, vatRate } = await this.resolveSaleCategoryDefaults(
        dto.categoryId,
      );
      dto.laborCost = laborCost;
      dto.vatRate = vatRate;
      // Hệ số nhân Bạc chỉ ORDER/ADMIN được chọn — Sale luôn dùng mặc định
      dto.silverMultiplier = undefined;
    }

    const options = await this.quoteOptionsService.generateOptions(dto);

    // Sale không xem Tiền công/VAT trong từng phương án — chỉ xem Giá bán
    if (actorRole === Role.SALE) {
      return options.map(({ laborCost, vat, ...rest }: any) => rest);
    }

    return options;
  }
}
