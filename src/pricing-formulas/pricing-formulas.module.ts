import { Module } from '@nestjs/common';
import { PricingFormulasService } from './pricing-formulas.service';
import { PricingFormulasController } from './pricing-formulas.controller';

@Module({
  controllers: [PricingFormulasController],
  providers: [PricingFormulasService],
  exports: [PricingFormulasService],
})
export class PricingFormulasModule {}
