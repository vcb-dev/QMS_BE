import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Body đổi tên hiển thị của chính mình. Tên được cắt khoảng trắng đầu/cuối trước khi kiểm tra,
// nên chuỗi chỉ gồm khoảng trắng bị coi là rỗng.
export class UpdateNameDto {
  @ApiProperty({
    description: 'Họ và tên hiển thị (1–100 ký tự)',
    example: 'Nguyễn Văn A',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Tên phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @MaxLength(100, { message: 'Họ tên tối đa 100 ký tự' })
  name: string;
}
