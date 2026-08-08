import { Controller, Get, Post, Body } from '@nestjs/common';
import { MetalPricesService } from './metal-prices.service';
import { MetalPrices } from './dto/metal-prices.dto';

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
