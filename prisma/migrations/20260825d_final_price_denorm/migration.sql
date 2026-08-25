-- Thêm cột denormalize "phương án báo giá đại diện" (finalOptionId/finalPrice) trên QuoteRequest —
-- đồng bộ app-layer (syncFinalOption trong quote-workflow.service.ts), không phải FK cứng. Mở khóa
-- SUM/ORDER BY/phân trang thật ở SQL cho Dashboard/Customers/Library thay vì tính tay ở Node mỗi lần đọc.

ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "final_option_id" TEXT;
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "final_price" DECIMAL(14,2);
CREATE INDEX IF NOT EXISTS "quote_requests_status_final_price_idx" ON "quote_requests"("status", "final_price");
