import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CalculatePriceInput {
  @IsNotEmpty({
    message: 'Vui lòng truyền tên hoặc mã chất liệu (materialNameOrKey)',
  })
  @IsString()
  materialNameOrKey: string;

  @IsNumber({}, { message: 'Trọng lượng chỉ phải là dạng số' })
  @Min(0, { message: 'Trọng lượng chỉ không được là số âm' })
  weightChi: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền công không được là số âm' })
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền đá không được là số âm' })
  stoneCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Thuế VAT không được là số âm' })
  vatRate?: number;

  @IsOptional()
  includeVat?: boolean;

  // Danh mục sản phẩm Sale chọn — dùng để tra tiền công chuẩn theo danh mục (ProductCategory.laborCost)
  @IsOptional()
  @IsString()
  categoryId?: string;

  // Hệ số nhân Bạc do người dùng chọn lúc tính giá (trong danh sách silverMultipliers cấu hình)
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Hệ số nhân Bạc không được là số âm' })
  silverMultiplier?: number;
}

export class PricingCalculationResult {
  materialNameOrKey: string;
  metalPricePerChi: number;
  totalMetalCost: number;
  metalRawCost: number;
  laborCost: number;
  stoneCost: number;
  stonePrice: number;
  stoneMarginLabel: string;
  totalProductionCost: number;
  profitMarginDivisor: number;
  profitMarginLabel: string;
  subtotalPrice: number;
  vatRate: number;
  vatAmount: number;
  quotedPrice: number;
}

export class CalculateMultiMaterialItem {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng truyền materialId cho từng chất liệu' })
  materialId: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng truyền materialName cho từng chất liệu' })
  materialName: string;

  @IsNumber({}, { message: 'Khối lượng chất liệu phải là dạng số' })
  @Min(0, { message: 'Khối lượng chất liệu không được là số âm' })
  weightChi: number;
}

export class CalculateMultiStoneItem {
  @IsString()
  @IsNotEmpty()
  stoneId: string;

  @IsNumber()
  @Min(1, { message: 'Số lượng đá tối thiểu là 1' })
  quantity: number;
}

export class CalculateMultiInput {
  @IsArray()
  @ArrayMinSize(1, { message: 'Cần ít nhất 1 chất liệu để tính giá' })
  @ValidateNested({ each: true })
  @Type(() => CalculateMultiMaterialItem)
  materials: CalculateMultiMaterialItem[];

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền công không được là số âm' })
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Thuế VAT không được là số âm' })
  vatRate?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  includeVat?: boolean;

  @IsOptional()
  @IsString()
  manualStoneName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền đá không được là số âm' })
  manualStonePrice?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CalculateMultiStoneItem)
  stones?: CalculateMultiStoneItem[];
}

export class CalculateMultiMaterialBreakdownItem {
  materialId: string;
  materialName: string;
  weightChi: number;
  cost: number;
}

export class CalculateMultiResult {
  totalMetalCost: number;
  metalRawCost: number;
  stoneCost: number;
  stonePrice: number;
  laborCost: number;
  vatAmount: number;
  quotedPrice: number;
  breakdown: CalculateMultiMaterialBreakdownItem[];
}
