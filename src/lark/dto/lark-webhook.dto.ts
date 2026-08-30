import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListLarkWebhookDto {
  @ApiPropertyOptional({ description: 'Tìm theo tên nhóm / tên bot' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['on', 'off'] })
  @IsOptional()
  @IsIn(['on', 'off'])
  status?: 'on' | 'off';

  @ApiPropertyOptional({ description: 'Lọc theo người cập nhật (users.id)' })
  @IsOptional()
  @IsString()
  updatedById?: string;

  @ApiPropertyOptional({ enum: ['24h', '7d', '30d'] })
  @IsOptional()
  @IsIn(['24h', '7d', '30d'])
  updatedWithin?: '24h' | '7d' | '30d';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

export class CreateLarkWebhookDto {
  @ApiProperty({ description: 'Tên nhóm Lark đích (chỉ để hiển thị)' })
  @IsString()
  @IsNotEmpty({ message: 'Tên nhóm Lark không được để trống' })
  chatName: string;

  @ApiPropertyOptional({ description: 'Tên Custom Bot' })
  @IsOptional()
  @IsString()
  botName?: string;

  @ApiProperty({ description: 'Webhook URL của Custom Bot Lark (duy nhất)' })
  @IsString()
  @IsNotEmpty({ message: 'Webhook URL không được để trống' })
  webhookUrl: string;

  @ApiPropertyOptional({
    description:
      'Signing secret. Bỏ trống = không ký. Không trả lại trong response.',
  })
  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @ApiPropertyOptional({ description: 'Bật/tắt webhook', default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Danh sách AuditAction webhook này nhận thông báo',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  actions?: string[];
}

export class UpdateLarkWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Tên nhóm Lark không được để trống' })
  chatName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  botName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Webhook URL không được để trống' })
  webhookUrl?: string;

  @ApiPropertyOptional({
    description:
      'Bỏ field = giữ nguyên secret. Chuỗi rỗng = xóa secret. Chuỗi khác = đặt secret mới.',
  })
  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  actions?: string[];
}
