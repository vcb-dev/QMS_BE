import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
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

  @ApiProperty({
    example: '123456',
    description: 'Mật khẩu khởi tạo (tối thiểu 6 ký tự)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu phải từ 6 ký tự trở lên' })
  password: string;

  // Tự đăng ký chỉ được chọn SALE/ORDER — ADMIN không cho tự nhận, phải do 1 ADMIN khác cấp
  // tay qua endpoint quản lý user (users.controller) sau khi tài khoản đã được duyệt.
  @ApiPropertyOptional({
    enum: [Role.SALE, Role.ORDER],
    default: Role.SALE,
    description: 'Vai trò (chỉ SALE hoặc ORDER — ADMIN không tự đăng ký được)',
  })
  @IsOptional()
  @IsIn([Role.SALE, Role.ORDER], {
    message:
      'Chỉ được tự đăng ký vai trò SALE hoặc ORDER. Tài khoản ADMIN do quản trị viên cấp riêng.',
  })
  role?: Role;

  @ApiPropertyOptional({ description: 'ID phòng ban' })
  @IsOptional()
  @IsString()
  departmentId?: string;
}
