-- Thêm khóa ngoại thật (provinceId/wardId) thay cho string tên tỉnh/phường tự do — giữ song song
-- cột province/ward cũ, KHÔNG xóa, KHÔNG backfill ở đây. Backfill làm riêng bằng script UPDATE sau
-- khi review được bao nhiêu customer khớp được tên, tránh gán sai khi tên không chính xác 100%.
ALTER TABLE "customers" ADD COLUMN "province_id" TEXT;
ALTER TABLE "customers" ADD COLUMN "ward_id" TEXT;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_province_id_fkey"
  FOREIGN KEY ("province_id") REFERENCES "provinces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_ward_id_fkey"
  FOREIGN KEY ("ward_id") REFERENCES "wards"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
