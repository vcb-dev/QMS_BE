import { Controller, Get, Put, Post, Body } from '@nestjs/common';
import { PricingConfigService } from './pricing-config.service';
import { PricingConfigDto, CalculatePriceInput } from './dto/pricing-config.dto';

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

  @Post('calculate')
  calculatePrice(@Body() dto: CalculatePriceInput) {
    return this.pricingConfigService.calculate5StepPrice(dto);
  }
}
