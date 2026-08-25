import { Controller, Get } from '@nestjs/common';
import { VnGoldPriceService } from './vn-gold-price.service';
import { Public } from '../auth/decorators/public.decorator';

// Giá vàng thị trường tham khảo (nguồn ngoài) — cố ý không gắn JwtAuthGuard, không phải giá cấu hình nội bộ.
@Public()
@Controller('vn-gold-price')
export class VnGoldPriceController {
  constructor(private readonly vnGoldPriceService: VnGoldPriceService) {}

  @Get()
  getLatest() {
    return this.vnGoldPriceService.getLatest();
  }
}
