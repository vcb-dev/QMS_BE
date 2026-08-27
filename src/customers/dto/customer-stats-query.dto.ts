import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CustomerStatsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['TOP_SPEND', 'MOST_ORDERS', 'RECENT'])
  sortMode?: 'TOP_SPEND' | 'MOST_ORDERS' | 'RECENT' = 'TOP_SPEND';

  @IsOptional()
  @IsString()
  provinceId?: string;

  // Lọc khách hàng theo nhân viên SALE đang theo dõi đơn (requesterId của quote_requests) —
  // không phải assigneeId (đó là nhân viên ORDER báo giá).
  @IsOptional()
  @IsString()
  requesterId?: string;

  @IsOptional()
  @IsIn(['ALL', 'TODAY', 'THIS_WEEK', 'THIS_MONTH'])
  timeRange?: string = 'ALL';

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 12;
}
