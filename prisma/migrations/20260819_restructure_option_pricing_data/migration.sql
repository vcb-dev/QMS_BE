-- restructure_option_pricing_data
-- Chuyển cụm dữ liệu báo giá (vat/quotedPrice/quotedDate/pricer/materials/stones)
-- từ QuoteRequest xuống QuoteOption. Áp thủ công qua DIRECT_URL (không qua pgbouncer),
-- KHÔNG dùng `prisma migrate dev` vì shadow-DB drift (xem log phiên làm việc).
--
-- Chính sách chốt với user trước khi chạy:
--   - 53 quote_requests không có option nào -> XOÁ (test data, user xác nhận).
--   - Request có nhiều option -> pricerId/quotedDate/materials/stones cấp Request
--     gán vào selectedOption; nếu chưa chọn option nào thì gán vào option cũ nhất (createdAt ASC).
--   - manualStoneName/manualStonePrice: 0/115 request có giá trị -> xoá thẳng, không cần migrate.
--   - vat/quotedPrice cấp Request: KHÔNG migrate — QuoteOption đã có vat/quotedPrice riêng
--     từ lúc tạo (không NULL), request-level chỉ là bản sao cũ, xoá thẳng an toàn.

BEGIN;

-- ============================================================
-- Phase 1: thêm cột mới trước, làm đích ghi dữ liệu ở Phase 2
-- ============================================================
ALTER TABLE "quote_requests" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "quote_options" ADD COLUMN "pricerId" TEXT;
ALTER TABLE "quote_options" ADD COLUMN "quoted_date" TIMESTAMP(3);

-- ============================================================
-- Phase 2: chuyển dữ liệu ra khỏi cột/bảng sắp bị xoá
-- ============================================================

-- 2a. pricerId (ai xử lý case) -> assigneeId
UPDATE "quote_requests"
SET "assigneeId" = "pricerId"
WHERE "pricerId" IS NOT NULL;

-- 2b. Xoá request test không có option nào (đã xác nhận với user) —
-- cascade tự xoá quote_request_materials/quote_request_stones/quote_request_images con của chúng.
DELETE FROM "quote_requests" qr
WHERE NOT EXISTS (SELECT 1 FROM "quote_options" qo WHERE qo."quote_request_id" = qr.id);

-- 2c. Xác định "option đích" cho mỗi request còn lại: selectedOption nếu có, else option cũ nhất
CREATE TEMP TABLE "_target_option" AS
SELECT qr.id AS request_id,
       COALESCE(
         qr."selected_option_id",
         (SELECT qo.id FROM "quote_options" qo WHERE qo."quote_request_id" = qr.id ORDER BY qo."createdAt" ASC LIMIT 1)
       ) AS option_id
FROM "quote_requests" qr;

-- 2d. Đẩy pricerId + quotedDate cấp Request vào option đích
UPDATE "quote_options" qo
SET "pricerId" = qr."pricerId",
    "quoted_date" = qr."quotedDate"
FROM "_target_option" t
JOIN "quote_requests" qr ON qr.id = t.request_id
WHERE qo.id = t.option_id;

-- 2e. Chuyển chất liệu chi tiết QuoteRequestMaterial -> QuoteOptionMaterial của option đích
INSERT INTO "quote_option_materials" (id, option_id, material_id, weight_chi, "createdAt")
SELECT gen_random_uuid()::text, t.option_id, qrm.material_id, qrm.weight_chi, qrm."createdAt"
FROM "quote_request_materials" qrm
JOIN "_target_option" t ON t.request_id = qrm.quote_request_id
ON CONFLICT (option_id, material_id) DO NOTHING;

-- 2f. Chuyển đá chi tiết QuoteRequestStone -> QuoteOptionStone của option đích
INSERT INTO "quote_option_stones" (id, option_id, stone_id, quantity, "createdAt")
SELECT gen_random_uuid()::text, t.option_id, qrs.stone_id, qrs.quantity, qrs."createdAt"
FROM "quote_request_stones" qrs
JOIN "_target_option" t ON t.request_id = qrs.quote_request_id
ON CONFLICT (option_id, stone_id) DO NOTHING;

DROP TABLE "_target_option";

-- ============================================================
-- Phase 3: xoá cột/bảng/constraint cũ (an toàn — data đã copy ra hết)
-- ============================================================
ALTER TABLE "quote_request_materials" DROP CONSTRAINT "quote_request_materials_material_id_fkey";
ALTER TABLE "quote_request_materials" DROP CONSTRAINT "quote_request_materials_quote_request_id_fkey";
ALTER TABLE "quote_request_stones" DROP CONSTRAINT "quote_request_stones_quote_request_id_fkey";
ALTER TABLE "quote_request_stones" DROP CONSTRAINT "quote_request_stones_stone_id_fkey";
ALTER TABLE "quote_requests" DROP CONSTRAINT "quote_requests_pricerId_fkey";

DROP INDEX "quote_requests_pricerId_idx";
DROP INDEX "quote_requests_pricerId_status_idx";

ALTER TABLE "quote_options"
  DROP COLUMN "material_summary",
  DROP COLUMN "stone_description";

ALTER TABLE "quote_requests"
  DROP COLUMN "manual_stone_name",
  DROP COLUMN "manual_stone_price",
  DROP COLUMN "pricerId",
  DROP COLUMN "quotedDate",
  DROP COLUMN "quotedPrice",
  DROP COLUMN "vat";

DROP TABLE "quote_request_materials";
DROP TABLE "quote_request_stones";

-- ============================================================
-- Phase 4: index + FK cho cột mới
-- ============================================================
CREATE INDEX "quote_options_pricerId_idx" ON "quote_options"("pricerId");
CREATE INDEX "quote_requests_assigneeId_idx" ON "quote_requests"("assigneeId");
CREATE INDEX "quote_requests_assigneeId_status_idx" ON "quote_requests"("assigneeId", "status");

ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_pricerId_fkey" FOREIGN KEY ("pricerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
