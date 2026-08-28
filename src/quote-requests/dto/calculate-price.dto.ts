import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CalculatePriceInput {
  @IsNotEmpty({
    message: 'Vui lòng truyền tên hoặc mã chất liệu (materialNameOrKey)',
  })
  @IsString()
  materialNameOrKey: string;

  @IsNumber({}, { message: 'Trọng lượng chỉ phải là dạng số' })
  @Min(0, { message: 'Trọng lượng chỉ không được là số âm' })
  weightChi: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền công không được là số âm' })
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền đá không được là số âm' })
  stoneCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Thuế VAT không được là số âm' })
  vatRate?: number;

  @IsOptional()
  includeVat?: boolean;

  // Danh mục sản phẩm Sale chọn — dùng để tra tiền công chuẩn theo danh mục (ProductCategory.laborCost)
  @IsOptional()
  @IsString()
  categoryId?: string;

  // Hệ số nhân Bạc do người dùng chọn lúc tính giá (trong danh sách silverMultipliers cấu hình)
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Hệ số nhân Bạc không được là số âm' })
  silverMultiplier?: number;
}

export class PricingCalculationResult {
  materialNameOrKey: string;
  metalPricePerChi: number;
  totalMetalCost: number;
  metalRawCost: number;
  laborCost: number;
  stoneCost: number;
  stonePrice: number;
  stoneMarginLabel: string;
  totalProductionCost: number;
  profitMarginDivisor: number;
  profitMarginLabel: string;
  subtotalPrice: number;
  vatRate: number;
  vatAmount: number;
  quotedPrice: number;
  // Giá bán phần chất liệu (kim loại + công + margin/VAT) = quotedPrice - stonePrice (đã làm tròn)
  materialPrice: number;
}

// 1 phương án cần tính trong lô — trùng field với CalculatePriceInput nhưng KHÔNG có categoryId
// (categoryId dùng chung, khai ở CalculateBatchInput).
export class CalculateBatchItem {
  @IsNotEmpty({
    message: 'Vui lòng truyền tên hoặc mã chất liệu (materialNameOrKey)',
  })
  @IsString()
  materialNameOrKey: string;

  @IsNumber({}, { message: 'Trọng lượng chỉ phải là dạng số' })
  @Min(0, { message: 'Trọng lượng chỉ không được là số âm' })
  weightChi: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền công không được là số âm' })
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền đá không được là số âm' })
  stoneCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Thuế VAT không được là số âm' })
  vatRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Hệ số nhân Bạc không được là số âm' })
  silverMultiplier?: number;
}

// Tính giá cho NHIỀU phương án trong 1 request — mỗi phương án là 1 (chất liệu + khối lượng) độc
// lập (KHÁC calculate-multi vốn cộng dồn nhiều chất liệu thành 1 sản phẩm). Load giá kim loại /
// danh mục chất liệu / bậc lợi nhuận đúng 1 lần cho cả lô, tránh N vòng request như trước.
export class CalculateBatchInput {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  includeVat?: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'Cần ít nhất 1 phương án để tính' })
  @ValidateNested({ each: true })
  @Type(() => CalculateBatchItem)
  items: CalculateBatchItem[];
}

// Kết quả 1 phương án trong lô: hoặc là PricingCalculationResult đầy đủ, hoặc { materialNameOrKey,
// error } nếu chất liệu đó không tra được cấu hình — FE bỏ qua phương án lỗi, không làm hỏng cả lô.
export class CalculateBatchResultItem {
  materialNameOrKey: string;
  error?: string;
  metalPricePerChi?: number;
  totalMetalCost?: number;
  metalRawCost?: number;
  laborCost?: number;
  stoneCost?: number;
  stonePrice?: number;
  totalProductionCost?: number;
  profitMarginDivisor?: number;
  profitMarginLabel?: string;
  vatRate?: number;
  vatAmount?: number;
  quotedPrice?: number;
  // Giá bán phần chất liệu = quotedPrice - stonePrice (không có khi phương án lỗi)
  materialPrice?: number;
}

export class CalculateMultiMaterialItem {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng truyền materialId cho từng chất liệu' })
  materialId: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng truyền materialName cho từng chất liệu' })
  materialName: string;

  @IsNumber({}, { message: 'Khối lượng chất liệu phải là dạng số' })
  @Min(0, { message: 'Khối lượng chất liệu không được là số âm' })
  weightChi: number;
}

export class CalculateMultiStoneItem {
  @IsString()
  @IsNotEmpty()
  stoneId: string;

  @IsNumber()
  @Min(1, { message: 'Số lượng đá tối thiểu là 1' })
  quantity: number;
}

export class CalculateMultiInput {
  @IsArray()
  @ArrayMinSize(1, { message: 'Cần ít nhất 1 chất liệu để tính giá' })
  @ValidateNested({ each: true })
  @Type(() => CalculateMultiMaterialItem)
  materials: CalculateMultiMaterialItem[];

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền công không được là số âm' })
  laborCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Thuế VAT không được là số âm' })
  vatRate?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  includeVat?: boolean;

  @IsOptional()
  @IsString()
  manualStoneName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Tiền đá không được là số âm' })
  manualStonePrice?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CalculateMultiStoneItem)
  stones?: CalculateMultiStoneItem[];
}

// Đầu vào tính giá "sống" cho 1 phương án báo giá đã lưu — dữ liệu lấy thẳng từ QuoteOption đã
// query sẵn (không query thêm), chỉ đổi phần TRA CỨU config (giá kim loại/đá/tỷ lệ/VAT) sang bản
// mới nhất thay vì giá đã đóng băng lúc báo giá.
export interface LivePriceItem {
  key: string;
  materials: { materialId: string; weightChi: number }[];
  laborCost: number;
  vatRate: number;
  // Có `stones` (đá chọn từ danh mục) thì lấy giá đá HIỆN TẠI; không có thì dùng thẳng
  // manualStoneCost (đá nhập tay, không có nguồn nào để tra giá "sống").
  stones?: { stoneId: string; quantity: number }[];
  manualStoneCost?: number;
}

export class CalculateMultiMaterialBreakdownItem {
  materialId: string;
  materialName: string;
  weightChi: number;
  cost: number;
}

export class CalculateMultiResult {
  totalMetalCost: number;
  metalRawCost: number;
  stoneCost: number;
  stonePrice: number;
  laborCost: number;
  vatAmount: number;
  quotedPrice: number;
  // Giá bán phần chất liệu = quotedPrice - stonePrice (đã làm tròn)
  materialPrice: number;
  breakdown: CalculateMultiMaterialBreakdownItem[];
}
