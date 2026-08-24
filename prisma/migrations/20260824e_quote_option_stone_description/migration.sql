-- Đá nhập tay (không chọn từ danh mục Stone) không có QuoteOptionStone nào để tra tên —
-- cần cột text snapshot riêng để lưu lại mô tả đá lúc báo giá.
ALTER TABLE "quote_options" ADD COLUMN "stone_description" TEXT;
