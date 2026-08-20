import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { QuoteStatus } from '@prisma/client';

export class FilterQuoteRequestDto {
  @IsOptional()
  @IsEnum(QuoteStatus, { message: 'Trạng thái không hợp lệ' })
  status?: QuoteStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  requesterId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  materialId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  includeCounts?: string;

  // Dashboard chỉ cần category/materials/requester/images để tính biểu đồ & vài ô mẫu,
  // không cần customer/pricer/options (quan hệ nặng nhất) — set 'true' để bỏ chúng khỏi query.
  @IsOptional()
  @IsString()
  lite?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  timeRange?: string;

  @IsOptional()
  @IsString()
  withPreviousCounts?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
