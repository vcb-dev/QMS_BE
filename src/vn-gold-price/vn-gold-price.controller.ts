import { Controller, Get } from '@nestjs/common';
import { VnGoldPriceService } from './vn-gold-price.service';

@Controller('vn-gold-price')
export class VnGoldPriceController {
  constructor(private readonly vnGoldPriceService: VnGoldPriceService) {}

  @Get()
  getLatest() {
    return this.vnGoldPriceService.getLatest();
  }
}
