import { IsOptional, IsString } from 'class-validator';
import { FilterQuoteRequestDto } from './filter-quote-request.dto';

export class ExportQuoteRequestDto extends FilterQuoteRequestDto {
  // Danh sách key cột muốn export, cách nhau bởi dấu phẩy (VD: "code,status,quotedPrice").
  // Bỏ trống = export toàn bộ cột.
  @IsOptional()
  @IsString()
  fields?: string;
}
