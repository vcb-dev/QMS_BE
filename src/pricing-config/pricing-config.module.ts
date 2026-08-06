import { Module } from '@nestjs/common';
import { PricingConfigService } from './pricing-config.service';
import { PricingConfigController } from './pricing-config.controller';

@Module({
  controllers: [PricingConfigController],
  providers: [PricingConfigService],
  exports: [PricingConfigService],
})
export class PricingConfigModule {}
