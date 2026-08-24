-- move_vat_to_category
-- VAT chuẩn (pricing_config.default_vat_rate — 1 giá trị global duy nhất cho cả hệ thống) chuyển
-- thành product_categories.vat_rate, mỗi danh mục sản phẩm có thể có mức VAT riêng — giống hệt
-- cách labor_cost đã lưu theo danh mục từ trước. Bảng pricing_config sau khi mất goldRatios/
-- profitMargins/silverMultipliers/defaultVatRate không còn gì đáng giữ, xóa luôn.

BEGIN;

ALTER TABLE "product_categories" ADD COLUMN "vat_rate" DECIMAL(5,2);

UPDATE "product_categories"
SET "vat_rate" = (SELECT "default_vat_rate" FROM "pricing_config" WHERE "id" = 'singleton');

-- Phòng trường hợp DB chưa từng có dòng pricing_config singleton (DB mới tinh)
UPDATE "product_categories" SET "vat_rate" = 10 WHERE "vat_rate" IS NULL;

DROP TABLE "pricing_config";

COMMIT;
