import { Module } from '@nestjs/common';
import { VnGoldPriceService } from './vn-gold-price.service';
import { VnGoldPriceController } from './vn-gold-price.controller';
import { MaterialsModule } from '../materials/materials.module';

@Module({
  imports: [MaterialsModule],
  controllers: [VnGoldPriceController],
  providers: [VnGoldPriceService],
})
export class VnGoldPriceModule {}
