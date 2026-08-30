import { IsIn, IsOptional, IsString } from 'class-validator';

// Query param lọc thời gian dùng chung cho các endpoint thống kê không thuộc riêng module nào
// (nhân viên: /users, /users/stats, /audit-log/stats, /quote-requests/staff-performance).
// customer-stats-query.dto.ts có các field này nhưng kèm search/sortMode/page/limit riêng của
// khách hàng nên không tái dùng trực tiếp.
export class TimeRangeQueryDto {
  @IsOptional()
  @IsIn([
    'ALL',
    'TODAY',
    'THIS_WEEK',
    'LAST_WEEK',
    'THIS_MONTH',
    'LAST_MONTH',
    'THIS_YEAR',
  ])
  timeRange?: string = 'ALL';

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
