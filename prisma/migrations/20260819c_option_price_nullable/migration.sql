-- option_price_nullable
-- Cho phép QuoteOption.quotedPrice NULL — option "nháp" (Sale khai chất liệu/đá mong muốn
-- lúc tạo yêu cầu, chưa có giá) vẫn tạo được, không cần giá giả 0. Không mất data.

BEGIN;
ALTER TABLE "quote_options" ALTER COLUMN "quoted_price" DROP NOT NULL;
COMMIT;
