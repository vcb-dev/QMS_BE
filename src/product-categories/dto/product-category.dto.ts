import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

export class CreateProductCategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên danh mục không được để trống' })
  @MaxLength(150, { message: 'Tên danh mục tối đa 150 ký tự' })
  name: string;

  @IsOptional()
  @IsNumber({}, { message: 'Tiền công phải là dạng số' })
  @Min(0, { message: 'Tiền công không được là số âm' })
  laborCost?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Thuế VAT phải là dạng số' })
  @Min(0, { message: 'Thuế VAT không được là số âm' })
  @Max(100, { message: 'Thuế VAT không hợp lệ (tối đa 100%)' })
  vatRate?: number;
}

export class UpdateProductCategoryDto {
  @IsOptional()
  @IsNumber({}, { message: 'Tiền công phải là dạng số' })
  @Min(0, { message: 'Tiền công không được là số âm' })
  laborCost?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Thuế VAT phải là dạng số' })
  @Min(0)
  @Max(100, { message: 'Thuế VAT không hợp lệ (tối đa 100%)' })
  vatRate?: number;
}

export class ProductCategoryBulkItemDto extends UpdateProductCategoryDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class UpdateProductCategoriesBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ProductCategoryBulkItemDto)
  items: ProductCategoryBulkItemDto[];
}

export class DeleteProductCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids: string[];
}
