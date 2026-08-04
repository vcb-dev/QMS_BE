import { IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';

export class CompleteQuoteDto {
  @IsNumber({}, { message: 'Giá báo phải là dạng số' })
  @Min(0, { message: 'Giá báo phải lớn hơn hoặc bằng 0' })
  @IsNotEmpty({ message: 'Báo giá không được để trống' })
  quotedPrice: number;

  @IsOptional()
  @IsNumber({}, { message: 'VAT phải là dạng số' })
  @Min(0)
  vat?: number;
}
