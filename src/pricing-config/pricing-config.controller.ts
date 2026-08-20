import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { PricingConfigService } from './pricing-config.service';
import {
  PricingConfigDto,
  CalculateMultiInput,
  CalculatePriceInput,
} from './dto/pricing-config.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('pricing-config')
export class PricingConfigController {
  constructor(
    private readonly pricingConfigService: PricingConfigService,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  // Sale không tự nhập tiền công — luôn lấy từ ProductCategory.laborCost theo danh mục sản phẩm đã chọn
  private async resolveSaleLaborCost(categoryId?: string): Promise<number> {
    if (!categoryId) return 0;
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
      select: { laborCost: true },
    });
    return category?.laborCost ? Number(category.laborCost) : 0;
  }

  /** Bảng tỉ lệ vàng & bảng margin gốc — Sale tuyệt đối không xem theo spec, chỉ ORDER/ADMIN */
  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Get()
  getConfig() {
    return this.pricingConfigService.getConfig();
  }

  /** Sửa tỉ lệ/hệ số ảnh hưởng toàn hệ thống — chỉ ORDER/ADMIN */
  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Put()
  updateConfig(@Body() dto: Partial<PricingConfigDto>) {
    return this.pricingConfigService.updateConfig(dto);
  }

  /** Danh sách hệ số nhân Bạc để chọn lúc báo giá — Sale cũng được xem (không lộ tỷ lệ vàng/bảng lợi nhuận) */
  @Get('silver-multipliers')
  async getSilverMultipliers() {
    const config = await this.pricingConfigService.getConfig();
    return { silverMultipliers: config.silverMultipliers };
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
      'PricingConfig',
    );

    // Sale không được tự nhập tiền công/mức VAT nữa. Tiền công lấy theo danh mục sản phẩm đã chọn
    // (ProductCategory.laborCost), VAT ép về mức chuẩn ORDER/ADMIN cấu hình.
    // Sale chỉ được chọn CÓ cộng VAT hay KHÔNG (dto.includeVat), không được tự set mức %.
    if (actorRole === Role.SALE) {
      const config = await this.pricingConfigService.getConfig();
      dto.laborCost = await this.resolveSaleLaborCost(dto.categoryId);
      dto.vatRate = dto.includeVat === false ? 0 : config.defaultVatRate;
    }

    const result = await this.pricingConfigService.calculate5StepPrice(dto);

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
      'PricingConfig',
    );

    if (actorRole === Role.SALE) {
      const config = await this.pricingConfigService.getConfig();
      dto.laborCost = await this.resolveSaleLaborCost(dto.categoryId);
      dto.vatRate = dto.includeVat === false ? 0 : config.defaultVatRate;
    }

    const result = await this.pricingConfigService.calculateMulti(dto);
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
      'PricingConfig',
    );

    // Sale không tự nhập tiền công/mức VAT. Tiền công lấy theo danh mục sản phẩm đã chọn
    // (ProductCategory.laborCost), VAT ép về mức chuẩn cấu hình. Sale chỉ chọn CÓ/KHÔNG cộng VAT (dto.includeVat do Sale gửi lên).
    if (actorRole === Role.SALE) {
      const config = await this.pricingConfigService.getConfig();
      dto.laborCost = await this.resolveSaleLaborCost(dto.categoryId);
      dto.vatRate = config.defaultVatRate;
    }

    const options = await this.pricingConfigService.generateOptions(dto);

    // Sale không xem Tiền công/VAT trong từng phương án — chỉ xem Giá bán
    if (actorRole === Role.SALE) {
      return options.map(({ laborCost, vat, ...rest }: any) => rest);
    }

    return options;
  }
}
