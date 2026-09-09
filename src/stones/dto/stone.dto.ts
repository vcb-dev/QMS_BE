import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StoneType } from '@prisma/client';

export class CreateStoneDto {
  @IsEnum(StoneType, {
    message: 'Loại đá phải là MAIN (đá chủ) hoặc SIDE (đá tấm)',
  })
  stoneType: StoneType;

  @IsString()
  @IsNotEmpty({ message: 'Tên đá không được để trống' })
  name: string;

  @IsOptional()
  @IsString()
  cut?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsNumber({}, { message: 'Giá đá phải là dạng số' })
  @Min(0)
  price: number;
}

export class UpdateStoneDto {
  @IsOptional()
  @IsEnum(StoneType)
  stoneType?: StoneType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  cut?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}

export class StonePriceItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsNumber({}, { message: 'Giá đá phải là dạng số' })
  @Min(0, { message: 'Giá đá không được là số âm' })
  price: number;
}

// Lưu giá nhiều viên đá cùng lúc. Trần 1000 khớp APP_CONSTANTS.MAX_IMPORT_ROWS — số dòng
// tối đa một lần import Excel, tức trần thực tế của bảng giá đá trên UI.
export class UpdateStonePricesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => StonePriceItemDto)
  items: StonePriceItemDto[];
}

export class DeleteStonesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids: string[];
}
