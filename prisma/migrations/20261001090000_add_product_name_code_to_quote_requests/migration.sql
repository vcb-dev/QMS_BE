-- Thêm tên sản phẩm (bắt buộc) + mã sản phẩm (không bắt buộc) vào yêu cầu báo giá.
-- Idempotent: chạy lại nhiều lần không lỗi.

ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "product_name" VARCHAR(300);
ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "product_code" VARCHAR(50);

-- Backfill yêu cầu cũ: trước đây tên sản phẩm là chuỗi ghép "<danh mục> <chất liệu của phương án
-- đại diện>" tính lúc đọc (bỏ phần "(xx.x%)" trong tên chất liệu). Ghi đúng chuỗi đó vào cột mới để
-- tên hiển thị của đơn cũ không đổi. Phương án đại diện = final_option_id, thiếu thì lấy phương án
-- tạo sớm nhất; đơn chưa có phương án nào thì chỉ còn tên danh mục.
UPDATE "quote_requests" qr
SET "product_name" = LEFT(
  COALESCE(
    NULLIF(
      BTRIM(
        CONCAT_WS(
          ' ',
          (SELECT pc."name" FROM "product_categories" pc WHERE pc."id" = qr."category_id"),
          (
            SELECT string_agg(
              REGEXP_REPLACE(m."name", '\s*\(\d+(\.\d+)?%\)', '', 'g'),
              ', '
              ORDER BY qom."created_at", qom."id"
            )
            FROM "quote_option_materials" qom
            JOIN "materials" m ON m."id" = qom."material_id"
            WHERE qom."option_id" = COALESCE(
              qr."final_option_id",
              (
                SELECT qo."id"
                FROM "quote_options" qo
                WHERE qo."quote_request_id" = qr."id"
                ORDER BY qo."created_at", qo."id"
                LIMIT 1
              )
            )
          )
        )
      ),
      ''
    ),
    'Sản phẩm chế tác'
  ),
  300
)
WHERE qr."product_name" IS NULL;

ALTER TABLE "quote_requests" ALTER COLUMN "product_name" SET NOT NULL;
