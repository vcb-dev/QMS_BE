import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
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
