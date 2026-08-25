-- Bỏ 2 cột string tự do "province"/"ward" ở customers — đã có FK thật province_id/ward_id
-- (migration 20260824d) thay thế. Backfill đã xong (chỉ 1 customer trong DB thật, đã có
-- province_id). 2 cột này TỪ ĐẦU (migration init) chưa từng có FK constraint thật, chỉ là
-- TEXT tự do — không cần drop constraint nào trước khi drop column.
ALTER TABLE "customers" DROP COLUMN IF EXISTS "province";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "ward";
