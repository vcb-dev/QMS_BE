import { IsNotEmpty, IsNumber, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QuoteOptionItemDto } from './quote-complete.dto';
import { CreateCustomerDto } from '../../customers/dto/create-customer.dto';

export class QuickQuoteSubmitDto {
  @IsOptional()
  @IsString()
  quoteRequestId?: string;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsNotEmpty({ message: 'Vui lòng chọn danh mục sản phẩm' })
  @IsString()
  categoryId: string;

  @IsOptional()
  @IsString()
  materialId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  newCustomer?: CreateCustomerDto;

  @IsOptional()
  @IsString()
  pricerId?: string;

  @IsOptional()
  @IsNumber()
  quotedPrice?: number;

  @IsOptional()
  @IsNumber()
  vat?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteOptionItemDto)
  options?: QuoteOptionItemDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
