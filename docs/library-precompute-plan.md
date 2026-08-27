# Kế hoạch: Thư viện sản phẩm precompute (`QuoteOption.libraryGroupKey`)

Mục tiêu: `getLibraryProducts` hiện kéo TOÀN BỘ option thỏa filter về JS rồi mới gộp nhóm →
O(số option). Chuyển khóa gộp nhóm sang cột tính-lúc-ghi để `GROUP BY` + phân trang phía SQL.

Quyết định đã chốt với user:
- Sort `PRICE_DESC` / `PRICE_ASC`: theo **giá đã báo** (`quoted_price`, SQL sắp được), KHÔNG theo giá
  sống. Chấp nhận lệch nhỏ ở các cặp giá suýt soát.
- Làm trên **DB cũ** (folder migration đã bị xóa sạch → áp SQL tay + `migrate resolve --applied`).

---

## ĐÃ XONG (2026-08-27)

- [x] `schema.prisma`: `QuoteOption.libraryGroupKey String?` + `@@index([libraryGroupKey])`
- [x] `src/utils/option-mapper.util.ts`: hàm thuần `computeLibraryGroupKey(opt, categoryId, materialBaseMetal, stoneMeta)` — nguồn sự thật DUY NHẤT
- [x] `test/option-mapper.util.spec.ts`: 5 test pin format khóa
- [x] **Step 2** — migration SQL: `prisma/migrations/20260827130000_quote_option_library_group_key/migration.sql` (CHƯA áp lên DB)
- [x] **Step 3** — `quote-options.service.ts`: `buildLibraryKeyMaps(effectiveOptions)`
- [x] **Step 4** — `buildOptionCreateInput` nhận tham số thứ 5 `keyMaps`, ghi `libraryGroupKey`
- [x] **Step 5** — 4 call site truyền `keyMaps`: `quote-requests.service.ts` (create) + `quote-workflow.service.ts` (completeQuote, QUICK_QUOTE, QUICK_APPROVE)
- [x] **Step 6** — `prisma/scripts/backfill-library-group-key.ts` (idempotent, cursor batch 500)
- [x] build + 56 test xanh

- [x] **Step 7** — viết lại `getLibraryProducts` (`quote-query.service.ts`): SQL `GROUP BY library_group_key` + phân trang phía DB, chỉ hydrate option của trang; sort `PRICE_ASC/DESC` theo `quoted_price` (`q_min`/`q_max`), `MOST_QUOTED` theo `dup_count`, `RECENT` theo `last_at`. Xóa `private libraryGroupKey()`. Thêm `libraryGroupKey: true` vào `hydrateLibraryOptions`.
- [x] **Step 8** — `test/quote-query.service.spec.ts`: `setup()` mock 2 lần `$queryRaw` (grpRows → optRows) + `keyOf()`; test sort đổi assert sang giá đã báo. 56 test xanh.

### DB — bạn đã chạy:
1. `ALTER TABLE quote_options ADD COLUMN library_group_key TEXT` + index — DONE
2. `migrate resolve --applied` + `prisma generate` — (xác nhận)
3. `npx ts-node prisma/scripts/backfill-library-group-key.ts` — (xác nhận)

### Kiểm tra tay sau khi restart dev server:
- Mở trang Thư Viện Sản Phẩm — số thẻ + cách gộp nhóm phải GIỐNG trước.
- Sort "giá cao → thấp": thứ tự giờ theo giá ĐÃ BÁO (có thể lệch nhẹ vài cặp so với số giá sống hiển thị — đúng thiết kế).
- Lọc theo Sale/Order/danh mục/ngày — vẫn đúng.
- Mở modal chi tiết 1 thẻ — lịch sử báo giá đầy đủ.

---

## CÒN LẠI

### Step 2 — Migration SQL (áp tay lên DB cũ)

`prisma/migrations/<timestamp>_library_group_key/migration.sql`:
```sql
ALTER TABLE "quote_options" ADD COLUMN "library_group_key" TEXT;
CREATE INDEX "quote_options_library_group_key_idx" ON "quote_options" ("library_group_key");
```
Áp: Supabase SQL Editor / DBeaver / `prisma db execute --file <path> --url "$DIRECT_URL"`, rồi
`npx prisma migrate resolve --applied <timestamp>_library_group_key` + `npx prisma generate`.

### Step 3 — Helper dựng 2 map (trong `quote-options.service.ts`)

```ts
async buildLibraryKeyMaps(effectiveOptions: any[]): Promise<{
  materialBaseMetal: Map<string, string | null>;
  stoneMeta: Map<string, { name: string; stoneType: string }>;
}> {
  const materialIds = [...new Set(effectiveOptions.flatMap(o => (o.materials||[]).map((m:any)=>m.materialId)))].filter(Boolean);
  const stoneIds    = [...new Set(effectiveOptions.flatMap(o => (o.stones||[]).map((s:any)=>s.stoneId)))].filter(Boolean);
  const [mats, stones] = await Promise.all([
    materialIds.length ? this.prisma.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, baseMetalId: true } }) : [],
    stoneIds.length    ? this.prisma.stone.findMany({ where: { id: { in: stoneIds } }, select: { id: true, name: true, stoneType: true } }) : [],
  ]);
  return {
    materialBaseMetal: new Map(mats.map(m => [m.id, m.baseMetalId])),
    stoneMeta: new Map(stones.map(s => [s.id, { name: s.name, stoneType: s.stoneType }])),
  };
}
```
(2 query nhỏ thêm mỗi lần GHI option — writes hiếm, chấp nhận được.)

### Step 4 — `buildOptionCreateInput` nhận thêm `keyMaps`, ghi `libraryGroupKey`

`option-mapper.util.ts`:
```ts
export function buildOptionCreateInput(
  opt, idx, categoryId?, stonePriceMap?,
  keyMaps?: { materialBaseMetal: Map<string,string|null>; stoneMeta: Map<string,{name:string;stoneType:string}> },
) {
  ...
  return {
    ...,
    dedupKey,
    libraryGroupKey: keyMaps
      ? computeLibraryGroupKey(opt, categoryId, keyMaps.materialBaseMetal, keyMaps.stoneMeta)
      : undefined,
    ...
  };
}
```

### Step 5 — 4 call site truyền `keyMaps`

Trước mỗi `.map(... buildOptionCreateInput ...)`, thêm:
```ts
const keyMaps = await this.quoteOptionsService.buildLibraryKeyMaps(effectiveOptions);
```
rồi truyền tham số thứ 5.

- `src/quote-requests/quote-requests.service.ts:147`
- `src/quote-requests/quote/quote-workflow.service.ts:189, 514, 565`
  (grep `buildOptionCreateInput` xác nhận lại số dòng trước khi sửa)

### Step 6 — Script backfill row cũ

`prisma/scripts/backfill-library-group-key.ts`:
```
- new PrismaClient
- load toàn bộ materials (id, baseMetalId) + stones (id, name, stoneType) -> 2 map
- lặp quote_options theo cursor (batch 500), mỗi option include { materials: {select materialId, weightChi}, stones: {select stoneId} }
- computeLibraryGroupKey(...) -> prisma.quoteOption.update({ where:{id}, data:{ libraryGroupKey } })
- log tiến độ
```
Chạy 1 lần: `npx ts-node prisma/scripts/backfill-library-group-key.ts`

### Step 7 — Viết lại `getLibraryProducts` (`quote-query.service.ts`)

```
1. SQL: phân trang KHÓA NHÓM + option đại diện + đếm, phía DB:
   SELECT DISTINCT ON (qo.library_group_key)
          qo.library_group_key,
          qo.id  AS rep_option_id,
          count(*)                    OVER (PARTITION BY qo.library_group_key) AS dup_count,
          max(qo.quoted_price)        OVER (PARTITION BY qo.library_group_key) AS price_max,
          min(qo.quoted_price)        OVER (PARTITION BY qo.library_group_key) AS price_min,
          max(COALESCE(qo.quoted_date, qr.created_at)) OVER (PARTITION BY qo.library_group_key) AS last_quoted_at
   FROM quote_options qo
   JOIN quote_requests qr ON qr.id = qo.quote_request_id
   LEFT JOIN product_categories pc ON pc.id = qr.category_id
   WHERE qo.quoted_price IS NOT NULL
     AND qr.status IN ('QUOTED','CLOSED')
     AND qo.library_group_key IS NOT NULL
     AND <các filter hiện có: categoryId, materialId EXISTS, salePersonId, orderPersonId, search ILIKE, timeRange/startDate/endDate>
   ORDER BY qo.library_group_key, COALESCE(qo.quoted_date, qr.created_at) DESC

   -- rồi bọc ngoài để sort theo dto.sortMode + LIMIT/OFFSET:
   --   PRICE_DESC -> price_max DESC ; PRICE_ASC -> price_min ASC
   --   MOST_QUOTED -> dup_count DESC ; RECENT -> last_quoted_at DESC

2. Chỉ hydrate + attachLivePrice cho rep_option_id của trang (<= limit cái).

3. buildLibraryGroupCard: bỏ tham số arr[] (cả nhóm) -> nhận rep option + các số đã tính sẵn từ SQL
   (dup_count, price_min/max, last_quoted_at). Phần "lịch sử báo giá" (history[]) trong card:
   - Option 1: query riêng khi user mở modal chi tiết (endpoint mới: GET library/:groupKey/history)
   - Option 2 (đơn giản hơn): giữ history nhưng chỉ query option cùng library_group_key của
     ĐÚNG các nhóm trên trang (WHERE library_group_key IN (...trang...)) — 1 query, không phải toàn bảng

4. Xóa: private libraryGroupKey(). GIỮ: dominantMaterial(), mainStoneNames(), weightRangeDisplay()
   (buildLibraryGroupCard vẫn cần để hiện tên/chất liệu/khoảng khối lượng).
```

### Step 8 — Test

- `test/quote-query.service.spec.ts`: cập nhật mock cho `$queryRaw` (giờ 2 lần: 1 lấy trang nhóm, 1 lấy history) + `quoteOption.findMany` chỉ rep.
- So sánh tay: mở trang Thư Viện trước/sau đổi, đếm số thẻ + thứ tự phải khớp trên cùng data.

---

## PLAN B — ĐÃ LÀM (2026-08-27)

- [x] B1: SQL query 1 thêm `rep_id` (array_agg), `w_min`/`w_max`
- [x] B2: bỏ query 2 (hydrate cả nhóm) → hydrate CHỈ rep của trang
- [x] B3: `buildLibraryCardFromRep(gkey, rep, agg)` + `weightRangeFromMinMax` + `buildHistoryEntry` (tách dùng chung); thẻ trả `history: []`, thêm `groupKey`
- [x] B4: endpoint `GET /api/quote-requests/library-history` + `getLibraryProductHistory` + `buildLibraryFilters` (helper filter dùng chung list + history); DTO `LibraryHistoryQueryDto` + base `LibraryFilterBase`
- [x] B5: FE — `fetchLibraryProductHistory` (api.ts), `LibraryHistoryResponse` (types), `ProductSpecModal` lazy-load + nút "Tải thêm lịch sử" (truyền filter ngoài), `LibraryPage` truyền `filters` + `key`
- [x] B6: spec `getLibraryProducts` cập nhật (grpRows có rep_id/w_min/w_max, hydrate rep) + spec mới `getLibraryProductHistory`. BE 53 test + FE build xanh.

Kết quả: list = O(8 dòng hydrate) bất kể nhóm to cỡ nào. Lịch sử báo giá lazy-load 20 đơn/trang.

---

## PLAN B — chi tiết (tham khảo)

Vấn đề còn lại của Step 7: mỗi thẻ trên trang vẫn hydrate TOÀN BỘ option của nhóm + nhồi hết
vào `history[]`. 1 sản phẩm báo giá 2000 lần → 1 lần load trang = vài nghìn row + vài nghìn lần
tính giá sống. Cần: list chỉ đụng 8 dòng đại diện, chi tiết (history) lazy-load + phân trang.

### B1 — SQL query 1: thêm rep_option_id + min/max weight
```sql
SELECT
  qo.library_group_key AS gkey,
  count(DISTINCT qo.quote_request_id) AS dup_count,
  min(qo.quoted_price) AS q_min,
  max(qo.quoted_price) AS q_max,
  min(qo.weight_chi)  AS w_min,
  max(qo.weight_chi)  AS w_max,
  max(COALESCE(qo.quoted_date, qr.created_at)) AS last_at,
  (array_agg(qo.id ORDER BY COALESCE(qo.quoted_date, qr.created_at) DESC, qo.id DESC))[1] AS rep_id,
  count(*) OVER () AS total
FROM quote_options qo
JOIN quote_requests qr ON qr.id = qo.quote_request_id
LEFT JOIN product_categories pc ON pc.id = qr.category_id
WHERE <filters cũ>
GROUP BY qo.library_group_key
ORDER BY <sortSql>, gkey
LIMIT :limit OFFSET :offset
```

### B2 — hydrate CHỈ rep options
`hydrateLibraryOptions(grpRows.map(r => r.rep_id))` — đúng 8 dòng. Bỏ query 2 (`optRows` toàn nhóm).

### B3 — buildLibraryGroupCard đổi chữ ký
`buildLibraryGroupCard(gkey, repOption, agg)` với `agg = { dupCount, qMin, qMax, wMin, wMax, lastAt }`:
- productName / matStr / stoneDisplay: từ repOption (nhóm thô → rep đại diện đủ, mọi option cùng
  category + base metal + tập đá MAIN)
- weightDisplay: từ `wMin`–`wMax` (SQL), không cần cả nhóm
- priceMin / priceMax (thẻ): `qMin` / `qMax` — giá ĐÃ BÁO, từ SQL (không tính giá sống cả nhóm)
- livePrice: chỉ tính cho repOption (1 lần)
- duplicateCount: `dupCount`
- **bỏ hẳn `history[]`** khỏi list response

### B4 — endpoint mới: history phân trang
`GET /api/quote-requests/library/history?groupKey=<>&page=N&limit=20` + **nhận cùng bộ filter
ngoài** (categoryId/salePersonId/orderPersonId/timeRange/startDate/endDate/search) để history khớp
đúng view đang lọc.

Service `getLibraryProductHistory(dto)`:
```
1. SQL: các quote_request có option thuộc groupKey + thỏa filter, sắp mới→cũ theo quoted_date,
   phân trang theo ĐƠN (1 dòng history = 1 đơn):
   SELECT qr.id, qr.code, qr.created_at, ...
   FROM quote_requests qr
   WHERE EXISTS (SELECT 1 FROM quote_options qo WHERE qo.quote_request_id = qr.id
                 AND qo.library_group_key = :gkey AND qo.quoted_price IS NOT NULL)
     AND <filter ngoài>
   ORDER BY (SELECT max(COALESCE(qo.quoted_date, qr.created_at)) FROM quote_options qo
             WHERE qo.quote_request_id = qr.id AND qo.library_group_key = :gkey) DESC
   LIMIT :limit OFFSET :offset
2. hydrate options của các đơn trang này (chỉ option cùng groupKey)
3. attachLivePrices cho các option đó
4. build history entries y hệt buildLibraryGroupCard.history hiện tại
5. return { data, meta: { total, page, limit } }
```

### B5 — FE
- `LibraryPage.tsx`: thẻ bỏ `history`, hiện "Đã báo giá {dupCount} lần"
- `ProductSpecModal.tsx` (chi tiết SP): mở modal → fetch `library/history?groupKey=...&page=1`,
  cuộn vô hạn hoặc nút phân trang
- Truyền filter thời gian toàn cục vào cả list fetch lẫn history fetch (Ask A)

### B6 — Test
- `quote-query.service.spec.ts`: mock query 1 có thêm `rep_id`/`w_min`/`w_max`, bỏ mock hydrate toàn nhóm
- spec mới cho `getLibraryProductHistory`

### File đụng (~6-8)
`quote-query.service.ts`, `quote-requests.controller.ts`, `dto/library-products-query.dto.ts` (+ dto history),
`LibraryPage.tsx`, `ProductSpecModal.tsx`, `services/api.ts`, 2 spec.

---

## Có nên làm bảng `product` riêng không?

**KHÔNG, chưa cần.** Lý do:

| | Bảng `library_product` (materialized) | `library_group_key` + GROUP BY (hiện tại) |
|---|---|---|
| List không filter | `SELECT ... LIMIT 8` — cực nhanh | GROUP BY 50k row ~50–150ms — vẫn ổn |
| List CÓ filter (sale/order/ngày/đá) | **vỡ** — aggregate (giá min/max, số lần) phải tính theo tập đã lọc, bảng tĩnh không làm được → vẫn phải quay về quote_options | tự nhiên đúng — GROUP BY chạy trên tập đã lọc |
| Đồng bộ | mỗi insert/update/**delete** option phải upsert + tính lại aggregate cho key đó (delete là ca khó) — cần trigger/app-layer | không cần, key tính 1 lần lúc ghi |
| Nguy cơ lệch số | có (sync sót) | không |

Số "sản phẩm" = số `library_group_key` phân biệt ≈ **2–5k** (không phải vài chục nghìn — đó là số
quote_options). GROUP BY trên 50k row ra 2–5k nhóm = việc Postgres làm tốt. Bảng product chỉ thắng
~100ms ở view mặc định, đổi lại thêm trigger sync + rủi ro staleness, và **không giải quyết** view
có filter (chỗ đau thật).

Chỉ cân nhắc bảng product khi: đo thực tế query 1 (GROUP BY) > 300ms trên data thật, VÀ view mặc
định không-filter chiếm > 90% lượt dùng. Ở quy mô này gần như không xảy ra. Plan B (bỏ over-hydrate)
mới là thứ đáng làm.

---

## Rủi ro & cách giảm

| Rủi ro | Giảm |
|---|---|
| Khóa write-path != logic đọc cũ | Đã trích `computeLibraryGroupKey` dùng chung. Backfill dùng đúng hàm đó. |
| Đụng logic gộp nhóm user đã tinh chỉnh nhiều lần | Giữ NGUYÊN quy tắc, chỉ đổi thời điểm tính. Test: đếm số thẻ trước/sau. |
| Row chưa backfill | Query lọc `library_group_key IS NOT NULL`; chạy backfill TRƯỚC khi deploy code mới. |
| Sort giá lệch so với giá sống hiển thị | User đã chấp nhận (option A). |
| `history[]` trong card vẫn kéo nhiều | Step 7.3 — giới hạn theo nhóm của trang. |
