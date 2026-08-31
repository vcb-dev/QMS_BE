import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MaterialWeightItemDto {
  @IsString()
  materialId: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Khối lượng không được là số âm' })
  weightChi?: number;
}

export class StoneSelectionItemDto {
  @IsString()
  stoneId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'Số lượng đá tối thiểu là 1' })
  quantity: number;
}

export class QuoteOptionItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MaxLength(200, { message: 'Tên phương án tối đa 200 ký tự' })
  optionName: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Khối lượng không được là số âm' })
  @Max(100000, { message: 'Khối lượng vượt ngưỡng hợp lệ' })
  weightChi?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Tiền công không được là số âm' })
  laborCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Tiền đá không được là số âm' })
  stoneCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Thuế VAT không được là số âm' })
  @Max(100, { message: 'Thuế VAT không hợp lệ (tối đa 100%)' })
  vat?: number;

  // Optional — option nháp (vd Sale khai chất liệu mong muốn lúc tạo yêu cầu) chưa có giá
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Giá báo không được là số âm' })
  quotedPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Ghi chú tối đa 2000 ký tự' })
  note?: string;

  // Tên/mô tả đá khi báo giá đá tổng nhập tay (không chọn từ danh mục Stone qua field `stones`)
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Mô tả đá tối đa 500 ký tự' })
  stoneDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Giá kim loại không được là số âm' })
  totalMetalCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Giá vốn kim loại không được là số âm' })
  metalRawCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Giá đá không được là số âm' })
  stonePrice?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialWeightItemDto)
  materials?: MaterialWeightItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoneSelectionItemDto)
  stones?: StoneSelectionItemDto[];

  // Phương án nào đang được chọn làm giá chính (FE radio/isSelected) — dùng để set
  // QuoteOption.selectionStatus = SELECTED khi tạo/ghi đè options.
  @IsOptional()
  @IsBoolean()
  isSelected?: boolean;
}

export class CompleteQuoteInput {
  options: QuoteOptionItemDto[];
}
