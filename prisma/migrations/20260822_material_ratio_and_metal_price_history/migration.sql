-- material_ratio_and_metal_price_history
-- 1) Tỷ lệ tính giá vàng theo tuổi (trước lưu ở pricing_config.gold_ratios JSON, tách rời khỏi
--    danh mục chất liệu) chuyển qua lưu trực tiếp trên từng dòng materials — mỗi chất liệu tự
--    mang % dùng nhân giá kim loại gốc lúc tính. Vàng theo tuổi = % thực áp dụng; Bạc/Bạch kim = 100%.
-- 2) metal_prices không còn là 1 dòng "singleton" bị ghi đè mỗi lần cập nhật — mỗi lần đổi giá tạo
--    1 dòng lịch sử mới (is_active đánh dấu giá đang dùng, kèm % biến động từng kim loại + người cập nhật).

BEGIN;

-- 1. Materials: thêm % tính giá — mặc định 100 (đúng cho Bạc/Bạch kim), backfill riêng cho Vàng
-- theo đúng applied ratio đang cấu hình ở pricing_config.gold_ratios (xem prisma/seed.ts cũ).
ALTER TABLE "materials" ADD COLUMN "price_ratio_pct" DECIMAL(5,2) NOT NULL DEFAULT 100;

UPDATE "materials" SET "price_ratio_pct" = 40   WHERE "name" ILIKE '%10K%';
UPDATE "materials" SET "price_ratio_pct" = 58   WHERE "name" ILIKE '%14K%';
UPDATE "materials" SET "price_ratio_pct" = 75   WHERE "name" ILIKE '%18K%';
UPDATE "materials" SET "price_ratio_pct" = 99.9 WHERE "name" ILIKE '%24K%' OR "name" ILIKE '%9999%';
-- Chất liệu khác (Bạc/Bạch kim/...) giữ nguyên mặc định 100 vừa set ở trên.
-- ⚠️ Nếu DB thật đang có thêm loại vàng khác (vd 16K, 22K) không khớp 4 pattern trên,
-- cần UPDATE tay bổ sung price_ratio_pct cho đúng applied ratio trước khi bỏ cột gold_ratios.

-- 2. pricing_config: bỏ bảng tỷ lệ vàng (đã chuyển qua materials.price_ratio_pct)
ALTER TABLE "pricing_config" DROP COLUMN "gold_ratios";

-- 3. metal_prices: chuyển từ 1 dòng singleton bị ghi đè sang bảng lịch sử append-only
ALTER TABLE "metal_prices" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "metal_prices" ADD COLUMN "gold_change_pct" DECIMAL(6,2);
ALTER TABLE "metal_prices" ADD COLUMN "silver_change_pct" DECIMAL(6,2);
ALTER TABLE "metal_prices" ADD COLUMN "platinum_change_pct" DECIMAL(6,2);
ALTER TABLE "metal_prices" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "metal_prices" ADD COLUMN "updated_by_id" TEXT;
ALTER TABLE "metal_prices" ADD COLUMN "updated_by_name" TEXT;
ALTER TABLE "metal_prices" RENAME COLUMN "updated_at" TO "created_at";
ALTER TABLE "metal_prices" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "metal_prices_is_active_idx" ON "metal_prices"("is_active");
CREATE INDEX "metal_prices_created_at_idx" ON "metal_prices"("created_at");

COMMIT;
