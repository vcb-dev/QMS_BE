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
