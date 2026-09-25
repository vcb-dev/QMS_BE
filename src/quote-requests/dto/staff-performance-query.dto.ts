import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TimeRangeQueryDto } from '../../common/time-range-query.dto';

// Sort/search/phân trang cho từng bảng (Sale + người báo giá) trong /staff-performance —
// tách riêng field vì 2 bảng có cột hoàn toàn khác nhau, không dùng chung 1 bộ tham số.
export class StaffPerformanceQueryDto extends TimeRangeQueryDto {
  @IsOptional()
  @IsString()
  saleSearch?: string;

  @IsOptional()
  @IsIn(['name', 'total', 'closed', 'closeRate'])
  saleSortField?: 'name' | 'total' | 'closed' | 'closeRate' = 'total';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  saleSortDir?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  salePage?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  salePageSize?: number = 10;

  @IsOptional()
  @IsString()
  pricerSearch?: string;

  @IsOptional()
  @IsIn(['name', 'totalHandled', 'medianQuoteMs', 'medianProcessMs'])
  pricerSortField?:
    | 'name'
    | 'totalHandled'
    | 'medianQuoteMs'
    | 'medianProcessMs' = 'totalHandled';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  pricerSortDir?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pricerPage?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pricerPageSize?: number = 10;
}
