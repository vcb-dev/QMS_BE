-- Thêm cột quote_requests.assigned_order_id: Order được hệ thống tự giao khi Sale tạo yêu cầu
-- (chia đều số đơn theo ngày). Khác assignee_id (người thực sự tiếp nhận/báo giá) — cột này chỉ để
-- hiển thị "Người được giao", không ràng buộc quyền thao tác.
-- Idempotent: chạy lại nhiều lần không lỗi. Đơn cũ để NULL (không backfill).
-- Chạy với search_path đúng schema `qms` (OMS cũng có bảng cùng tên ở schema khác).

ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "assigned_order_id" TEXT;

-- Phục vụ 2 truy vấn của bộ chia đơn: đếm đơn đã giao từ 00:00 hôm nay và lấy lần giao gần nhất,
-- cả hai đều lọc theo assigned_order_id rồi xét created_at.
CREATE INDEX IF NOT EXISTS "quote_requests_assigned_order_id_created_at_idx"
  ON "quote_requests"("assigned_order_id", "created_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_requests_assigned_order_id_fkey'
      AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
  ) THEN
    ALTER TABLE "quote_requests"
      ADD CONSTRAINT "quote_requests_assigned_order_id_fkey" FOREIGN KEY ("assigned_order_id")
      REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
