-- Kết nối metal_prices / audit_logs / pricing_formulas với bảng users bằng FK thật thay vì lưu
-- trùng tên (updated_by_name / actor_name). Tên actor giờ tra qua quan hệ lúc đọc dữ liệu.
-- FK dùng ON DELETE SET NULL để giữ nguyên lịch sử (giá/log/công thức) khi tài khoản bị xóa.

BEGIN;

-- 1. metal_prices: bỏ cột lưu tên trùng, thêm FK cho updated_by_id
ALTER TABLE "metal_prices" DROP COLUMN "updated_by_name";
ALTER TABLE "metal_prices"
  ADD CONSTRAINT "metal_prices_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "metal_prices_updated_by_id_idx" ON "metal_prices"("updated_by_id");

-- 2. audit_logs: bỏ cột lưu tên trùng, thêm FK cho actor_id
ALTER TABLE "audit_logs" DROP COLUMN "actor_name";
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- 3. pricing_formulas: thêm cột + FK người sửa lần gần nhất (trước không có)
ALTER TABLE "pricing_formulas" ADD COLUMN "updated_by_id" TEXT;
ALTER TABLE "pricing_formulas"
  ADD CONSTRAINT "pricing_formulas_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "pricing_formulas_updated_by_id_idx" ON "pricing_formulas"("updated_by_id");

COMMIT;
