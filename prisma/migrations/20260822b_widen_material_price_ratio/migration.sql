-- widen_material_price_ratio
-- % tính giá của chất liệu (materials.price_ratio_pct) không chỉ giới hạn 0-100 nữa — cho phép
-- lên tới 1000% (vd chất liệu đắt hơn giá kim loại gốc). Decimal(5,2) cũ chỉ chứa tối đa 999.99,
-- nới lên Decimal(6,2) để chứa được 1000.00.

BEGIN;
ALTER TABLE "materials" ALTER COLUMN "price_ratio_pct" TYPE DECIMAL(6,2);
COMMIT;
