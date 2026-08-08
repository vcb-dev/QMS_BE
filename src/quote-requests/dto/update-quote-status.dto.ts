import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QuoteOptionItemDto } from './quote-complete.dto';

export enum QuoteAction {
  ACCEPT = 'ACCEPT',
  QUOTE = 'QUOTE',
  REJECT = 'REJECT',
  RETURN = 'RETURN',
  RESUBMIT = 'RESUBMIT',
  SELECT_OPTION = 'SELECT_OPTION',
  QUICK_QUOTE = 'QUICK_QUOTE',
  QUICK_APPROVE = 'QUICK_APPROVE',
  QUICK_REJECT = 'QUICK_REJECT',
}

export class UpdateQuoteStatusDto {
  @IsEnum(QuoteAction, { message: 'Hành động không hợp lệ' })
  @IsNotEmpty({ message: 'Vui lòng truyền loại hành động action' })
  action: QuoteAction;

  @IsOptional()
  @IsNumber()
  version?: number;

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
  rejectReason?: string;

  @IsOptional()
  @IsString()
  returnReason?: string;

  @IsOptional()
  @IsString()
  optionId?: string;
}
