import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  MaxLength,
  ValidateNested,
} from 'class-validator';
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
  MARK_CLOSED = 'MARK_CLOSED',
}

export class UpdateQuoteStatusDto {
  @IsEnum(QuoteAction, { message: 'Hành động không hợp lệ' })
  @IsNotEmpty({ message: 'Vui lòng truyền loại hành động action' })
  action: QuoteAction;

  @IsOptional()
  @IsNumber()
  version?: number;

  // Toàn bộ dữ liệu báo giá (vat/quotedPrice/materials/stones) nằm trong từng phần tử options[] —
  // không còn field rời cấp ngoài (QuoteRequest không lưu cụm này nữa).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteOptionItemDto)
  options?: QuoteOptionItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Lý do từ chối tối đa 2000 ký tự' })
  rejectReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Lý do cần bổ sung tối đa 2000 ký tự' })
  returnReason?: string;

  @IsOptional()
  @IsString()
  optionId?: string;
}
