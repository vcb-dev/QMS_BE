import { Controller, Get, Put, Body } from '@nestjs/common';
import { PricingConfigService, PricingConfigDto } from './pricing-config.service';

@Controller('pricing-config')
export class PricingConfigController {
  constructor(private readonly pricingConfigService: PricingConfigService) {}

  @Get()
  getConfig() {
    return this.pricingConfigService.getConfig();
  }

  @Put()
  updateConfig(@Body() dto: Partial<PricingConfigDto>) {
    return this.pricingConfigService.updateConfig(dto);
  }
}
