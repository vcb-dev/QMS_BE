-- sql/2026-09-19_add_quote_option_materials_raw_cost.sql
-- Idempotent — safe to run more than once. Run by hand in DBeaver against the DB
-- qms_be/.env's DATABASE_URL points at.
--
-- Lưu giá vốn kim loại thô riêng từng dòng chất liệu trong 1 phương án báo giá (khác
-- quote_options.metal_raw_cost là tổng của tất cả chất liệu cộng lại) — để trang Chi Tiết hiện
-- được giá gốc từng kim loại thay vì chỉ hiện tổng. Record cũ (tạo trước cột này tồn tại) giữ NULL.

ALTER TABLE public.quote_option_materials
  ADD COLUMN IF NOT EXISTS raw_cost NUMERIC(14, 2);
