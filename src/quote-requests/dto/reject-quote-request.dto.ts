import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RejectQuoteRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do từ chối' })
  @MinLength(3, { message: 'Lý do từ chối quá ngắn' })
  rejectReason: string;
}
