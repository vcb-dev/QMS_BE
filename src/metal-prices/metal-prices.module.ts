import { Module } from '@nestjs/common';
import { MetalPricesService } from './metal-prices.service';
import { MetalPricesController } from './metal-prices.controller';

@Module({
  controllers: [MetalPricesController],
  providers: [MetalPricesService],
  exports: [MetalPricesService],
})
export class MetalPricesModule {}
