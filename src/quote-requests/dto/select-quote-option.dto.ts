import { IsNotEmpty, IsString } from 'class-validator';

export class SelectQuoteOptionDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn ID phương án báo giá' })
  optionId: string;
}
