-- Snapshot giá đá tại thời điểm báo giá — Stone.price có thể đổi sau này, không snapshot thì
-- xem lại đơn cũ ra giá đá sai (giá hôm nay) dù quote_options.stone_price đã đóng băng đúng tổng tiền.
-- NULL = record tạo trước khi có cột này, code fallback đọc stones.price hiện tại.
ALTER TABLE "quote_option_stones" ADD COLUMN "unit_price_at_quote" DECIMAL(14,2);
