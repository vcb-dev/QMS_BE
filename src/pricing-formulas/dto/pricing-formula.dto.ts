import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PricingFormulaType } from '@prisma/client';

export class MarginTier {
  // Mốc chi phí (đã gồm VAT) mà bậc này còn áp dụng. Trần 100 tỷ để một số nhập nhầm
  // (thừa số 0) không lọt xuống DB rồi làm lệch mọi báo giá sau đó.
  @IsNumber()
  @Min(0)
  @Max(100_000_000_000)
  maxCost: number;

  // Giá bán = chi phí có VAT / divisor. divisor càng nhỏ giá càng cao, nên chặn cả 2 đầu:
  // dưới 0.2 nghĩa là nhân từ 5 lần trở lên, gần như chắc chắn là nhập sai.
  @IsNumber()
  @Min(0.2)
  @Max(1)
  divisor: number;

  @IsString()
  @MaxLength(100)
  margin: string;
}

// Hình dạng config khi formulaType = MULTIPLIER.
export class MultiplierConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @Max(20, { each: true })
  multipliers: number[];
}

// Hình dạng config khi formulaType = MARGIN_TIERS.
export class MarginTiersConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MarginTier)
  tiers: MarginTier[];
}

export class CreatePricingFormulaDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên công thức không được để trống' })
  @MaxLength(150)
  name: string;

  @IsEnum(PricingFormulaType, { message: 'Loại công thức không hợp lệ' })
  formulaType: PricingFormulaType;

  // config đổi hình dạng theo formulaType nên không khai được bằng decorator trên một class
  // duy nhất — validate ở service, xem assertValidConfig().
  @IsOptional()
  config?: unknown;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdatePricingFormulaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  config?: unknown;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

// MARGIN_TIERS dùng `tiers`, MULTIPLIER dùng `multipliers` — 1 formula chỉ có đúng 1 trong 2
export class PricingFormulaConfig {
  tiers?: MarginTier[];
  multipliers?: number[];
}

export class PricingFormulaDto {
  id: string;
  name: string;
  formulaType: 'MARGIN_TIERS' | 'MULTIPLIER';
  config: PricingFormulaConfig;
  isDefault: boolean;
  updatedAt: string;
}
