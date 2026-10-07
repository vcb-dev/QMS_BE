import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Body tạo/đổi tên team. Tên được cắt khoảng trắng đầu/cuối trước khi kiểm tra, nên chuỗi chỉ gồm
// khoảng trắng bị coi là rỗng.
export class TeamNameDto {
  @ApiProperty({
    description: 'Tên team (1–100 ký tự)',
    example: 'Team Hà Nội',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Tên team phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tên team không được để trống' })
  @MaxLength(100, { message: 'Tên team tối đa 100 ký tự' })
  name: string;
}
