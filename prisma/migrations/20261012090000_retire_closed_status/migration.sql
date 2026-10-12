-- Gỡ khái niệm "Đã chốt với khách hàng" khỏi DỮ LIỆU và khỏi hàm sync_final_option().
-- CỐ Ý GIỮ giá trị CLOSED trong enum "QuoteStatus" / "OptionSelectionStatus": Postgres không có
-- DROP VALUE, và CI chạy migrate TRƯỚC khi redeploy nên code cũ còn dùng literal 'CLOSED' trong lúc
-- chuyển giao. Migration chỉ làm cho không còn dòng nào mang giá trị đó.
-- Idempotent: chạy lại nhiều lần không lỗi. Chạy với search_path đúng schema `qms`.

-- 1a. Đơn có NHIỀU option CLOSED (dữ liệu lệch — không có ràng buộc DB chặn): chỉ giữ option CLOSED
--     tạo sớm nhất, các option CLOSED còn lại về NONE. Đây cũng chính là option mà sync_final_option()
--     cũ chọn làm final (CLOSED trước, rồi created_at ASC) nên final_option_id không đổi.
UPDATE "quote_options" o
SET "selection_status" = 'NONE'
WHERE o."selection_status" = 'CLOSED'
  AND EXISTS (
    SELECT 1 FROM "quote_options" k
    WHERE k."quote_request_id" = o."quote_request_id"
      AND k."selection_status" = 'CLOSED'
      AND (k."created_at", k."id") < (o."created_at", o."id")
  );

-- 1b. Đơn có option CLOSED: option SELECTED khác về NONE để sau bước 2 mỗi đơn chỉ còn đúng 1 SELECTED.
UPDATE "quote_options" o
SET "selection_status" = 'NONE'
WHERE o."selection_status" = 'SELECTED'
  AND EXISTS (
    SELECT 1 FROM "quote_options" c
    WHERE c."quote_request_id" = o."quote_request_id"
      AND c."selection_status" = 'CLOSED'
  );

-- 2. Option CLOSED -> SELECTED (giữ phương án khách đã chốt làm phương án chính); đơn CLOSED -> QUOTED.
--    final_option_id / final_price không đổi vì SELECTED vẫn xếp trên mọi option khác.
UPDATE "quote_options" SET "selection_status" = 'SELECTED' WHERE "selection_status" = 'CLOSED';
UPDATE "quote_requests" SET "status" = 'QUOTED' WHERE "status" = 'CLOSED';

-- 3. Viết lại sync_final_option() không còn nhánh CLOSED. CREATE OR REPLACE tạo hàm ở schema đầu tiên
--    của search_path — nếu hàm cũ nằm ở schema khác sẽ âm thầm tạo bản trùng, nên chặn trước.
DO $$
BEGIN
  IF to_regprocedure(current_schema() || '.sync_final_option(text)') IS NULL THEN
    RAISE EXCEPTION 'Không thấy sync_final_option(text) trong schema % — kiểm tra search_path', current_schema();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sync_final_option(p_quote_request_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_option_id TEXT;
  v_price     DECIMAL(14,2);
BEGIN
  SELECT id, quoted_price INTO v_option_id, v_price
  FROM quote_options
  WHERE quote_request_id = p_quote_request_id
  ORDER BY
    CASE selection_status WHEN 'SELECTED' THEN 0 ELSE 1 END,
    CASE WHEN selection_status = 'NONE' AND quoted_price IS NOT NULL THEN 0 ELSE 1 END,
    CASE WHEN selection_status = 'NONE' AND quoted_price IS NOT NULL THEN created_at END DESC,
    created_at ASC
  LIMIT 1;

  UPDATE quote_requests
  SET final_option_id = v_option_id,
      final_price = v_price
  WHERE id = p_quote_request_id;
END;
$function$;
