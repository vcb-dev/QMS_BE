-- Đảm bảo ở tầng DB: chỉ 1 dòng "đang active/mặc định/đang chọn" tại 1 thời điểm — trước giờ
-- chỉ code tầng service tự giữ invariant này, không có ràng buộc DB nên race condition (2 request
-- ghi đồng thời) có thể tạo ra 2 dòng cùng active/default/selected.
--
-- QUAN TRỌNG: chạy 3 câu SELECT kiểm tra bên dưới TRƯỚC — nếu ra kết quả (có trùng lặp), phải dọn
-- sạch data trước, nếu không migration này sẽ FAIL khi CREATE UNIQUE INDEX.
--
-- SELECT COUNT(*) FROM metal_prices WHERE is_active = true;                          -- kỳ vọng <= 1
-- SELECT COUNT(*) FROM pricing_formulas WHERE is_default = true;                     -- kỳ vọng <= 1
-- SELECT quote_request_id, COUNT(*) FROM quote_options
--   WHERE selection_status = 'SELECTED' GROUP BY 1 HAVING COUNT(*) > 1;              -- kỳ vọng rỗng

CREATE UNIQUE INDEX "metal_prices_one_active" ON "metal_prices" ("is_active") WHERE "is_active" = true;

CREATE UNIQUE INDEX "pricing_formulas_one_default" ON "pricing_formulas" ("is_default") WHERE "is_default" = true;

CREATE UNIQUE INDEX "quote_options_one_selected" ON "quote_options" ("quote_request_id") WHERE "selection_status" = 'SELECTED';
