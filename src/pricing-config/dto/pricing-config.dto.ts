import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class GoldRatio {
  key: string;
  standard: number;
  applied: number;
  label: string;
}

export class ProfitMargin {
  maxCost: number;
  divisor: number;
  margin: string;
}

export class PricingConfigDto {
  goldRatios: GoldRatio[];
  profitMargins: ProfitMargin[];
  silverMultiplier: number;
  updatedAt?: string;
}

export class CalculatePriceInput {
  @IsNotEmpty({ message: 'Vui lòng truyền tên hoặc mã chất liệu (materialNameOrKey)' })
  @IsString()
  materialNameOrKey: string;

  @IsNumber({}, { message: 'Trọng lượng chỉ phải là dạng số' })
  weightChi: number;

  @IsOptional()
  @IsNumber()
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  stoneCost?: number;

  @IsOptional()
  @IsNumber()
  vatRate?: number;

}

export class PricingCalculationResult {
  materialNameOrKey: string;
  metalPricePerChi: number;
  totalMetalCost: number;
  laborCost: number;
  stoneCost: number;
  totalProductionCost: number;
  profitMarginDivisor: number;
  profitMarginLabel: string;
  subtotalPrice: number;
  vatRate: number;
  vatAmount: number;
  quotedPrice: number;
}
