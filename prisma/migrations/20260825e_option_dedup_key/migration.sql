-- Thêm cột denormalize dedup_key trên quote_options — khóa gộp sản phẩm trùng (category + chất
-- liệu + đá) cho trang Quản Lý Sản Phẩm, tính sẵn lúc ghi option (option-mapper.util.ts), tránh
-- phải JOIN nhiều bảng mỗi lần query danh sách.

ALTER TABLE "quote_options" ADD COLUMN IF NOT EXISTS "dedup_key" TEXT;
CREATE INDEX IF NOT EXISTS "quote_options_dedup_key_idx" ON "quote_options"("dedup_key");
