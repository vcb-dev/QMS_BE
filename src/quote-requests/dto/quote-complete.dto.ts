import { IsNumber, IsOptional, IsString, IsBoolean } from 'class-validator';

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

