import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Bộ lọc + phân trang danh sách Thư Viện Sản Phẩm — mỗi yêu cầu báo giá đã QUOTED/CLOSED là 1 thẻ.
export class LibraryProductsQueryDto {
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

  @IsOptional()
  @IsIn(['PRICE_DESC', 'PRICE_ASC', 'RECENT'])
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
