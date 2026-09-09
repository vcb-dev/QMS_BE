import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMaterialDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên chất liệu không được để trống' })
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn công thức tính lãi cho chất liệu' })
  pricingFormulaId: string;

  // Khoảng 0-1000 giữ nguyên ngưỡng của assertValidRatio đang có trong materials.service.ts.
  @IsOptional()
  @IsNumber({}, { message: '% tính giá phải là dạng số' })
  @Min(0, { message: '% tính giá phải trong khoảng 0-1000' })
  @Max(1000, { message: '% tính giá phải trong khoảng 0-1000' })
  priceRatioPct?: number;

  @IsOptional()
  @IsString()
  baseMetalId?: string;
}

export class UpdateMaterialDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsNumber({}, { message: '% tính giá phải là dạng số' })
  @Min(0, { message: '% tính giá phải trong khoảng 0-1000' })
  @Max(1000, { message: '% tính giá phải trong khoảng 0-1000' })
  priceRatioPct?: number;

  @IsOptional()
  @IsString()
  pricingFormulaId?: string;

  @IsOptional()
  @IsString()
  baseMetalId?: string | null;
}
