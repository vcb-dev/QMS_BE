import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { PricingConfigService } from './pricing-config.service';
import { PricingConfigDto, CalculatePriceInput } from './dto/pricing-config.dto';
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

  private async logAction(actorId: string, actorRole: Role, action: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    await this.auditLog.log({ actorId, actorName: actor?.name || 'Không rõ', actorRole, action, entityType: 'PricingConfig' });
  }

  /** Bảng tỉ lệ vàng & bảng margin gốc — Sale tuyệt đối không xem theo spec, chỉ PRICING/ADMIN */
  @UseGuards(RolesGuard)
  @Roles(Role.PRICING, Role.ADMIN)
  @Get()
  getConfig() {
    return this.pricingConfigService.getConfig();
  }

  /** Sửa tỉ lệ/hệ số ảnh hưởng toàn hệ thống — chỉ PRICING/ADMIN */
  @UseGuards(RolesGuard)
  @Roles(Role.PRICING, Role.ADMIN)
  @Put()
  updateConfig(@Body() dto: Partial<PricingConfigDto>) {
    return this.pricingConfigService.updateConfig(dto);
  }

  @Post('calculate')
  async calculatePrice(
    @Body() dto: CalculatePriceInput,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: Role,
  ) {
    await this.logAction(actorId, actorRole, 'CALCULATE_PRICE');
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

  @Post('generate-options')
  async generateOptions(
    @Body() dto: any,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: Role,
  ) {
    await this.logAction(actorId, actorRole, 'GENERATE_PRICING_OPTIONS');
    return this.pricingConfigService.generateOptions(dto);
  }
}
