import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Bộ lọc dùng chung cho cả danh sách Thư Viện lẫn lịch sử báo giá 1 sản phẩm — history phải khớp
// đúng view đang lọc (VD lọc theo Sale X thì lịch sử cũng chỉ hiện đơn của X).
class LibraryFilterBase {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  materialId?: string;

  // Lọc theo Sale (người tạo yêu cầu, role SALE = requesterId).
  @IsOptional()
  @IsString()
  salePersonId?: string;

  // Lọc theo Order (người xử lý/báo giá, role ORDER = assigneeId).
  @IsOptional()
  @IsString()
  orderPersonId?: string;

  @IsOptional()
  @IsIn(['ALL', 'TODAY', 'THIS_WEEK', 'THIS_MONTH'])
  timeRange?: string = 'ALL';

  // Khoảng ngày tùy chọn (YYYY-MM-DD) — lọc theo ngày báo giá, fallback ngày tạo đơn. Áp dụng
  // cùng lúc với timeRange (AND) nếu cả hai đều có.
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class LibraryProductsQueryDto extends LibraryFilterBase {
  @IsOptional()
  @IsIn(['PRICE_DESC', 'PRICE_ASC', 'RECENT', 'MOST_QUOTED'])
  sortMode?: string = 'PRICE_DESC';

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
  limit?: number = 8;
}

// Lịch sử báo giá của 1 sản phẩm (1 thẻ Thư Viện) — lazy load khi mở modal chi tiết, phân trang
// theo ĐƠN (1 dòng lịch sử = 1 yêu cầu báo giá).
export class LibraryHistoryQueryDto extends LibraryFilterBase {
  @IsString()
  groupKey!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
