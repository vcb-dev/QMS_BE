import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  MaxLength,
  Min,
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
  EDIT_PRICE = 'EDIT_PRICE',
  // Chỉ ADMIN: hủy đơn (trạng thái cuối, chỉ ADMIN thấy) và khôi phục về trạng thái trước khi hủy.
  CANCEL = 'CANCEL',
  RESTORE = 'RESTORE',
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

  // Tiền kiểm định Order nhập lúc báo giá (QUOTE) hoặc sửa giá (EDIT_PRICE) — lưu trên QuoteRequest,
  // đã được cộng sẵn vào quotedPrice của từng option qua /quote-options/calculate-batch.
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền kiểm định không được là số âm' })
  inspectionFee?: number;
}
