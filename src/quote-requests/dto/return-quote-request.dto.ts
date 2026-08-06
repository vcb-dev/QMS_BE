import { IsNotEmpty, IsString } from 'class-validator';

export class ReturnQuoteRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Lý do trả lại bổ sung thông tin không được để trống' })
  returnReason: string;
}
