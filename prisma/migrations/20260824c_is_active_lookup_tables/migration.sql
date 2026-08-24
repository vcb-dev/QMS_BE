-- Cho phép "ngừng dùng" 1 chất liệu/đá/danh mục/công thức mà không phải xóa cứng — xóa cứng sẽ
-- vỡ FK từ QuoteOption/QuoteRequest cũ đang trỏ tới. Default true = không ảnh hưởng data cũ.
ALTER TABLE "materials" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "stones" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "product_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "pricing_formulas" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
