import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  Max,
  Min,
} from 'class-validator';

export class CreateQuoteRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn khách hàng' })
  customerId: string;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  desiredLeadTime?: string; // 7. Thời gian khách muốn nhận

  @IsOptional()
  @IsString()
  materialId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  materialIds?: string[];

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn danh mục sản phẩm' })
  categoryId: string;

  @IsOptional()
  @IsString()
  newCategoryName?: string; // Tên danh mục mới nếu chọn "Khác"

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Thời gian muốn nhận không hợp lệ' })
  desiredDate?: Date;

  @IsOptional()
  @IsString()
  customerMeasurements?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Tỷ lệ chốt phải là dạng số' })
  @Min(0)
  @Max(100)
  closeRatePct?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
