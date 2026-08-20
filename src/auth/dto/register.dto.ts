import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Nguyễn Văn A', description: 'Họ và tên người dùng' })
  @IsString({ message: 'Tên phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  name: string;

  @ApiProperty({ example: 'user@vcb.vn', description: 'Email đăng ký' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @ApiProperty({ example: '123456', description: 'Mật khẩu khởi tạo (tối thiểu 6 ký tự)' })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu phải từ 6 ký tự trở lên' })
  password: string;

  @ApiPropertyOptional({ enum: Role, default: Role.SALE, description: 'Vai trò (SALE, ORDER, ADMIN)' })
  @IsOptional()
  @IsEnum(Role, { message: 'Vai trò không hợp lệ (chỉ nhận SALE, ORDER, ADMIN)' })
  role?: Role;

  @ApiPropertyOptional({ description: 'ID phòng ban' })
  @IsOptional()
  @IsString()
  departmentId?: string;
}
