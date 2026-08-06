import { IsNumber, IsOptional, IsArray, ValidateNested, IsString, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class QuoteOptionItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  optionName: string;

  @IsOptional()
  @IsString()
  materialName?: string;

  @IsOptional()
  @IsNumber()
  weightChi?: number;

  @IsOptional()
  @IsNumber()
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  stoneCost?: number;

  @IsOptional()
  @IsString()
  stoneDescription?: string;

  @IsOptional()
  @IsNumber()
  vat?: number;

  @IsNumber()
  quotedPrice: number;

  @IsOptional()
  @IsBoolean()
  isSelected?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CompleteQuoteDto {
  @IsNumber()
  quotedPrice: number;

  @IsOptional()
  @IsNumber()
  vat?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteOptionItemDto)
  options?: QuoteOptionItemDto[];
}
