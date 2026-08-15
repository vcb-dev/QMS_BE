import { Module } from '@nestjs/common';
import { VnGoldPriceService } from './vn-gold-price.service';
import { VnGoldPriceController } from './vn-gold-price.controller';
import { PricingConfigModule } from '../pricing-config/pricing-config.module';

@Module({
  imports: [PricingConfigModule],
  controllers: [VnGoldPriceController],
  providers: [VnGoldPriceService],
})
export class VnGoldPriceModule {}
