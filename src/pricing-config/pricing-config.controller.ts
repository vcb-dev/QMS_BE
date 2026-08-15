import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { PricingConfigService } from './pricing-config.service';
import { PricingConfigDto, CalculatePriceInput } from './dto/pricing-config.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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

  @Get()
  getConfig() {
    return this.pricingConfigService.getConfig();
  }

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
    return this.pricingConfigService.calculate5StepPrice(dto);
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
