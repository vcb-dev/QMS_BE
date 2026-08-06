import { Controller, Get, Post, Body } from '@nestjs/common';
import { MetalPricesService, MetalPrices } from './metal-prices.service';

@Controller('metal-prices')
export class MetalPricesController {
  constructor(private readonly metalPricesService: MetalPricesService) {}

  @Get()
  getLatest() {
    return this.metalPricesService.getLatest();
  }

  /** Manual refresh endpoint (admin use) */
  @Post()
  updatePrices(@Body() prices: Partial<MetalPrices>) {
    return this.metalPricesService.updatePrices(prices);
  }
}

