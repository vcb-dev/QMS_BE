import { Module } from '@nestjs/common';
import { PricingConfigService } from './pricing-config.service';
import { PricingConfigController } from './pricing-config.controller';
import { MetalPricesModule } from '../metal-prices/metal-prices.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [MetalPricesModule, AuditLogModule],
  controllers: [PricingConfigController],
  providers: [PricingConfigService],
  exports: [PricingConfigService],
})
export class PricingConfigModule {}
