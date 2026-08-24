-- pricing_formula_per_material
-- Công thức tính lãi (profitMargins/silverMultipliers) trước gom chung 1 JSON tách rời trong
-- pricing_config, dùng chung cho MỌI chất liệu — muốn thêm kim loại/công thức mới phải sửa code.
-- Giờ tách thành bảng pricing_formulas (gắn theo NHÓM — nhiều chất liệu dùng chung 1 công thức),
-- mỗi materials.pricing_formula_id trỏ tới 1 công thức. Thêm chất liệu mới chỉ cần trỏ tới công
-- thức có sẵn hoặc tạo công thức mới qua UI — không sửa code.

BEGIN;

CREATE TYPE "PricingFormulaType" AS ENUM ('MARGIN_TIERS', 'MULTIPLIER');

CREATE TABLE "pricing_formulas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formula_type" "PricingFormulaType" NOT NULL,
    "config" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_formulas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_formulas_name_key" ON "pricing_formulas"("name");

-- Backfill 2 công thức từ đúng dữ liệu ĐANG SỐNG trong pricing_config (không hardcode giá trị cũ,
-- lấy nguyên các bậc lợi nhuận/hệ số nhân admin đã cấu hình thật)
INSERT INTO "pricing_formulas" ("id", "name", "formula_type", "config", "is_default", "updated_at")
SELECT 'pfm_margin_tiers_default', 'Bậc lợi nhuận theo chi phí', 'MARGIN_TIERS',
       jsonb_build_object('tiers', "profit_margins"), true, now()
FROM "pricing_config" WHERE "id" = 'singleton';

INSERT INTO "pricing_formulas" ("id", "name", "formula_type", "config", "is_default", "updated_at")
SELECT 'pfm_silver_multiplier_default', 'Hệ số nhân Bạc', 'MULTIPLIER',
       jsonb_build_object('multipliers', "silver_multipliers"), false, now()
FROM "pricing_config" WHERE "id" = 'singleton';

-- Phòng trường hợp DB chưa từng có dòng pricing_config singleton (DB mới tinh) — tạo công thức
-- rỗng để materials luôn có chỗ trỏ tới (bắt buộc NOT NULL ở bước dưới)
INSERT INTO "pricing_formulas" ("id", "name", "formula_type", "config", "is_default", "updated_at")
SELECT 'pfm_margin_tiers_default', 'Bậc lợi nhuận theo chi phí', 'MARGIN_TIERS', '{"tiers": []}'::jsonb, true, now()
WHERE NOT EXISTS (SELECT 1 FROM "pricing_formulas" WHERE "id" = 'pfm_margin_tiers_default');

INSERT INTO "pricing_formulas" ("id", "name", "formula_type", "config", "is_default", "updated_at")
SELECT 'pfm_silver_multiplier_default', 'Hệ số nhân Bạc', 'MULTIPLIER', '{"multipliers": [2.5, 3]}'::jsonb, false, now()
WHERE NOT EXISTS (SELECT 1 FROM "pricing_formulas" WHERE "id" = 'pfm_silver_multiplier_default');

-- Materials: thêm cột trỏ công thức (nullable trước để backfill, set NOT NULL sau)
ALTER TABLE "materials" ADD COLUMN "pricing_formula_id" TEXT;

UPDATE "materials" SET "pricing_formula_id" = 'pfm_silver_multiplier_default'
WHERE ("name" ILIKE '%bạc%' AND "name" NOT ILIKE '%bạch%') OR "name" ILIKE '%silver%' OR "name" ILIKE '%925%';

UPDATE "materials" SET "pricing_formula_id" = 'pfm_margin_tiers_default'
WHERE "pricing_formula_id" IS NULL;
-- ⚠️ Chất liệu tên lạ không khớp pattern Bạc ở trên sẽ mặc định rơi vào công thức bậc lợi nhuận —
-- kiểm tra lại nếu DB thật có chất liệu Bạc đặt tên khác thường.

ALTER TABLE "materials" ALTER COLUMN "pricing_formula_id" SET NOT NULL;
ALTER TABLE "materials" ADD CONSTRAINT "materials_pricing_formula_id_fkey"
    FOREIGN KEY ("pricing_formula_id") REFERENCES "pricing_formulas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "materials_pricing_formula_id_idx" ON "materials"("pricing_formula_id");

-- pricing_config: bỏ 2 cột đã chuyển sang pricing_formulas
ALTER TABLE "pricing_config" DROP COLUMN "profit_margins";
ALTER TABLE "pricing_config" DROP COLUMN "silver_multipliers";

COMMIT;
