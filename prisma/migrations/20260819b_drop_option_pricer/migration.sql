-- drop_option_pricer
-- Bỏ QuoteOption.pricerId — pricer chỉ có 1 theo cấp Request (đã có QuoteRequest.assigneeId),
-- không lặp lại theo từng option. Xác nhận của user: "không có 1 thôi và nó theo người báo giá
-- cho yêu cầu nên có thể xóa ở option đi". Không mất data — assigneeId đã có sẵn giá trị tương ứng.

BEGIN;

ALTER TABLE "quote_options" DROP CONSTRAINT "quote_options_pricerId_fkey";
DROP INDEX "quote_options_pricerId_idx";
ALTER TABLE "quote_options" DROP COLUMN "pricerId";

COMMIT;
