-- Thêm trạng thái "Đã hủy" (CANCELLED) cho yêu cầu báo giá + 2 cột nullable phục vụ hủy/khôi phục.
-- CHỈ THÊM, không UPDATE nào dùng giá trị mới: Postgres không cho dùng enum value vừa ADD VALUE
-- trong cùng transaction, và CI chạy migrate TRƯỚC khi redeploy nên code cũ vẫn chạy bình thường.
-- Idempotent: chạy lại nhiều lần không lỗi. Chạy với search_path đúng schema `qms`.
-- Hàm/trigger sync_final_option() không bị ảnh hưởng.

ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- cancelled_at: mốc ADMIN hủy. cancelled_from_status: trạng thái ngay trước khi hủy (chỉ lưu giá trị
-- CŨ của enum) để khôi phục về đúng chỗ. Cả hai về NULL khi khôi phục. Người hủy lấy từ audit_logs
-- (action CANCEL_QUOTE), không có cột riêng.
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "cancelled_from_status" "QuoteStatus";
