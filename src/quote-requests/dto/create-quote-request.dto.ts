import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { QuoteOptionItemDto } from './quote-complete.dto';

// Gửi qua multipart/form-data (kèm files upload ảnh thật, không còn base64) thì multer trả field
// KHÔNG phải file về dạng string thô, kể cả field vốn là mảng/object — FE phải JSON.stringify()
// trước khi append vào FormData, BE parse lại ở đây. Gửi JSON thường (không kèm ảnh) thì value đã
// là mảng sẵn, giữ nguyên không đổi gì.
function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export class CreateQuoteRequestDto {
  // Bỏ trống = khách không khai báo thông tin → BE tự gán vào khách chung "Khách lẻ"
  // (quote-requests.service.resolveWalkInCustomerId), KHÔNG tạo bản ghi khách hàng mới mỗi lần.
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Tên sản phẩm tối đa 300 ký tự' })
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Thời gian muốn nhận tối đa 2000 ký tự' })
  desiredLeadTime?: string; // 7. Thời gian khách muốn nhận

  @IsOptional()
  @IsString()
  materialId?: string;

  @IsOptional()
  @Transform(({ value }) => parseIfJsonString(value))
  @IsArray()
  @IsString({ each: true })
  materialIds?: string[];

  @IsOptional()
  @Transform(({ value }) => parseIfJsonString(value))
  @IsArray()
  @IsString({ each: true })
  stoneIds?: string[]; // Đá khách muốn (đá chủ/đá tấm) khai lúc tạo yêu cầu — không bắt buộc

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn danh mục sản phẩm' })
  categoryId: string;

  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'Tên danh mục tối đa 150 ký tự' })
  newCategoryName?: string; // Tên danh mục mới nếu chọn "Khác"

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Thời gian muốn nhận không hợp lệ' })
  desiredDate?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Số đo khách tối đa 2000 ký tự' })
  customerMeasurements?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Tỷ lệ chốt phải là dạng số' })
  @Min(0)
  @Max(100)
  closeRatePct?: number;

  // Ảnh CŨ đã có sẵn (lúc sửa yêu cầu) — URL Cloudinary thật, BE chỉ pass-through không upload lại
  // (xem CloudinaryService.uploadBase64OrUrl). Ảnh MỚI đi qua field `files` (multipart, upload thật).
  @IsOptional()
  @Transform(({ value }) => parseIfJsonString(value))
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  // Video CŨ đã có sẵn (lúc sửa yêu cầu, giữ nguyên không đổi) — URL Cloudinary thật, BE pass-through
  // không upload lại. Video MỚI đi qua field `video` (multipart, upload thật, xem CloudinaryService.uploadVideo).
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'URL video tối đa 1000 ký tự' })
  videoUrl?: string;

  // @Transform trả object/mảng thô (parse JSON string xong là dừng) — @Type đứng sau đôi khi KHÔNG
  // tự dựng lại thành instance QuoteOptionItemDto (tùy thứ tự xử lý decorator của class-transformer),
  // khiến class-validator không nhận diện được field nào của DTO nữa và whitelist reject sạch cả
  // (báo "property X should not exist" dù X có khai trong DTO) — chỉ xảy ra không đều tay ("lúc được
  // lúc không") nên rất khó bắt lỗi qua test thủ công. Tự plainToInstance() tường minh ở đây để luôn
  // chắc chắn có instance đúng class, không phụ thuộc thứ tự xử lý ngầm của @Type.
  @IsOptional()
  @Transform(({ value }) => {
    const parsed = parseIfJsonString(value);
    return Array.isArray(parsed)
      ? parsed.map((o) => plainToInstance(QuoteOptionItemDto, o))
      : parsed;
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteOptionItemDto)
  options?: QuoteOptionItemDto[];
}
