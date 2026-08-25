import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @IsOptional()
  @IsIn(['ALL', 'TODAY', 'THIS_WEEK', 'THIS_MONTH'])
  timeRange?: string = 'ALL';

  @IsOptional()
  @IsIn(['PRICE_DESC', 'PRICE_ASC', 'RECENT', 'MOST_QUOTED'])
  sortMode?: string = 'PRICE_DESC';

  @IsOptional()
  @IsString()
  withLivePrice?: string;

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
