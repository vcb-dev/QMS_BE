import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty({
    description: 'Họ và tên khách hàng',
    example: 'Nguyễn Văn An',
  })
  @IsString()
  @IsNotEmpty({ message: 'Tên khách hàng không được để trống' })
  name: string;

  @ApiPropertyOptional({
    description: 'Số điện thoại liên hệ',
    example: '0901234567',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Tỉnh / Thành phố riêng biệt (text tự do, giữ tương thích ngược)',
    example: 'Hồ Chí Minh',
  })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({
    description:
      'Phường / Xã / Quận / Huyện riêng biệt (text tự do, giữ tương thích ngược)',
    example: 'Phường Bến Nghé, Quận 1',
  })
  @IsOptional()
  @IsString()
  ward?: string;

  @ApiPropertyOptional({
    description:
      'ID tỉnh/thành đã chọn từ danh mục — ưu tiên hơn province (text) nếu có',
  })
  @IsOptional()
  @IsString()
  provinceId?: string;

  @ApiPropertyOptional({
    description:
      'ID phường/xã đã chọn từ danh mục — ưu tiên hơn ward (text) nếu có',
  })
  @IsOptional()
  @IsString()
  wardId?: string;

  @ApiPropertyOptional({
    description: 'Địa chỉ cụ thể (Số nhà, Tên đường)',
    example: '123 Nguyễn Huệ',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    description: 'Ghi chú thêm về khách hàng',
    example: 'Khách VIP mua nhẫn cưới',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
