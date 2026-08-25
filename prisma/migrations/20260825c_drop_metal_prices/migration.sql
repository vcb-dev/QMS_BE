-- Xóa bảng metal_prices (Metal Price flat 3-column: gold24kVnd/silverVnd/platinumVnd) — đã thay
-- bằng base_metals + base_metal_price_history (migration 20260825b_base_metal_catalog). Dữ liệu
-- lịch sử đã copy đủ sang base_metal_price_history (backfill Task 3, đã verify). Không code nào
-- (kể cả prisma/seed.ts) còn đụng tới bảng này nữa.

ALTER TABLE "metal_prices" DROP CONSTRAINT IF EXISTS "metal_prices_updated_by_id_fkey";

DROP TABLE "metal_prices";
