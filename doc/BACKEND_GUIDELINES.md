# Quy tắc tuân thủ — Backend (qms_be)

Tài liệu này quy định các quy tắc bắt buộc khi phát triển backend hệ thống VCB QMS
(NestJS 11 + Prisma 6 + PostgreSQL/Supabase). Mọi thay đổi mã nguồn `qms_be/` phải
tuân theo. Khi một quy tắc mâu thuẫn với thói quen cá nhân hoặc gợi ý mặc định của
thư viện, quy tắc trong tài liệu này thắng.

Nguồn tham chiếu bổ sung: `doc/DEVELOPER_GUIDE.md`, `doc/API.md`,
`doc/project_workflow_docs.md`, và `qms_be/prisma/schema.prisma` (mô hình dữ liệu
là nguồn sự thật).

---

## 1. Kiến trúc & phân lớp

- Tổ chức mã theo **module NestJS gắn với nghiệp vụ** (`auth`, `quote-requests`,
  `pricing-formulas`, `materials`, `customers`, `audit-log`, `lark`, ...). Mỗi
  module có `*.module.ts`, `*.controller.ts`, `*.service.ts`, thư mục `dto/`.
- **Controller mỏng**: chỉ khai báo route, guard, Swagger decorator, nhận DTO và
  uỷ quyền xuống service. Không đặt logic nghiệp vụ, không gọi Prisma trực tiếp
  trong controller.
- **Service chứa toàn bộ logic nghiệp vụ** và mọi truy cập Prisma. Khi service quá
  lớn, tách theo trách nhiệm (ví dụ `quote-requests/quote/` có `quote-query`,
  `quote-workflow`, `quote-analytics`) thay vì gộp một file khổng lồ.
- **Logic tính toán thuần** (số vào — số ra, không DB, không DI) đặt trong
  `src/utils/*.util.ts` và được import bởi service. Ví dụ chuẩn:
  `utils/pricing-math.util.ts`. Không nhúng công thức tính giá vào service.
- **Type và hằng số không đặt inline** trong file service/controller. Đưa type dùng
  chung vào `dto/*.types.ts` hoặc file type riêng; hằng số cấu hình vào
  `common/constants.ts` (`APP_CONSTANTS`) hoặc file `*.constants.ts` của module.
- Ưu tiên **bổ sung vào file util/const/types có sẵn** thay vì tạo file mới một mục
  đích; gộp các service mỏng có cùng một nhiệm vụ.

---

## 2. Xác thực & phân quyền

- Auth dùng **JWT đặt trong HttpOnly cookie** (`crmspd_at` access, `crmspd_rt`
  refresh) là chính; vẫn chấp nhận `Authorization: Bearer` để tương thích. Tên
  cookie và header khai báo tập trung ở `auth/cookie/cookie.constants.ts`.
- **Refresh token rotation bắt buộc**: mỗi lần refresh phải sinh cặp token mới và
  cập nhật `refreshTokenHash` (SHA-256) xuống DB. Refresh token cũ bị vô hiệu.
- Chỉ lưu **hash** của refresh token và OTP reset mật khẩu xuống DB, không lưu giá
  trị gốc. Mật khẩu băm bằng `bcrypt` (cost 10).
- Guard toàn cục đã bật ở `AppModule`: `ThrottlerGuard` (60 request/phút) và
  `CsrfGuard`. **Không tự ý gỡ**.
- **CSRF**: double-submit cookie (`crmspd_csrf` cookie phải khớp header
  `x-csrf-token`). Route công khai (login, refresh, forgot/reset password, Lark
  OAuth callback) đánh dấu `@SkipCsrf()`. GET/HEAD/OPTIONS được bỏ qua tự động.
- Mọi controller nghiệp vụ phải `@UseGuards(JwtAuthGuard, RolesGuard)` và khai báo
  `@ApiBearerAuth('JWT-auth')`.
- **Phân quyền theo role** qua `@Roles(Role.SALE | Role.ORDER | Role.ADMIN)`. Khi
  luồng nghiệp vụ có ràng buộc role phức tạp (ai được ACCEPT, ai được REJECT...),
  kiểm tra lại **trong service** (xem `QuoteWorkflowService.assertRole` /
  `assertPricingCanProcess`) — không chỉ dựa vào decorator.
- `ORDER` chỉ được thao tác trên yêu cầu **do chính mình tiếp nhận**
  (`assigneeId === userId`); `ADMIN` không bị ràng buộc này.
- Không tin `userId`/`role` do client gửi. Luôn lấy từ token qua
  `@CurrentUser('id')` / `@CurrentUser('role')`.

---

## 3. Bảo mật dữ liệu nghiệp vụ nhạy cảm

- **Role `SALE` không bao giờ được thấy cấu thành giá vốn**: `laborCost`,
  `stoneCost`, `totalMetalCost`, `metalRawCost`, `stonePrice` (giá đá thô). Sale
  chỉ được xem `quotedPrice` (giá bán) và `priceBreakdown` (tách giá chất
  liệu / giá đá đã có lãi).
- Việc ẩn field này phải làm ở **tầng service**, không phải chỉ ở frontend. Dùng
  `QuoteQueryService.stripCostFieldsForSale()` cho **mọi** đường trả dữ liệu
  option về Sale — kể cả các action trong `QuoteWorkflowService`
  (`markClosed`, `resubmit`, `selectOption`...) trả trực tiếp
  `mapQuoteRequestDetail()`.
- Khi thêm field giá vốn mới vào `QuoteOption`, phải cập nhật đồng thời danh sách
  loại trừ trong `stripCostFieldsForSale()`.
- Trước khi giả định "bug ẩn giá do phân quyền", phải xác nhận lỗi tái hiện trên
  nhiều role — có thể chỉ là lỗi hiển thị chung.

---

## 4. DTO & validation

- `ValidationPipe` toàn cục bật `whitelist: true`, `forbidNonWhitelisted: true`,
  `transform: true`. Field không khai báo trong DTO sẽ bị **từ chối** (400) —
  luôn khai báo đầy đủ field hợp lệ trong DTO.
- Validate bằng `class-validator`; ép kiểu số/boolean từ query bằng
  `@Type(() => Number)` + `@IsInt()` (query luôn là string).
- **Thông báo lỗi validate viết tiếng Việt**, hướng người dùng cuối
  (ví dụ `{ message: 'Trạng thái không hợp lệ' }`).
- DTO update kế thừa từ create qua `PartialType` (`@nestjs/mapped-types`).
- Field phân trang: `page` mặc định 1, `limit` mặc định 10, đều `@Min(1)`.

---

## 5. Prisma & thiết kế schema

`qms_be/prisma/schema.prisma` là nguồn sự thật của mô hình dữ liệu. Các ràng buộc
bắt buộc:

- **Đặt tên**: field TypeScript camelCase, cột DB snake_case qua `@map`; bảng qua
  `@@map` (số nhiều, snake_case).
- **Tiền tệ / trọng lượng dùng `Decimal`** với độ chính xác cố định
  (`@db.Decimal(14, 2)` cho tiền VNĐ, `@db.Decimal(8, 3)` cho số chỉ,
  `@db.Decimal(6, 2)` / `@db.Decimal(5, 2)` cho phần trăm). Không dùng `Float`
  cho tiền.
- **Không xoá cứng bảng lookup** (`Material`, `Stone`, `ProductCategory`,
  `BaseMetal`, `PricingFormula`...). Dùng cờ `isActive = false` để ẩn khỏi
  dropdown, giữ nguyên bản ghi để không vỡ FK từ dữ liệu lịch sử.
- **Không có bảng đảo (island table)**: mọi bảng mới phải có ít nhất một FK nối
  vào mô hình quan hệ hiện tại. Không tạo bảng đứng một mình chỉ chứa dữ liệu rời.
- **Cấu hình / thiết lập là bảng lịch sử append-only, không phải singleton
  một dòng**. Ví dụ: giá kim loại lưu ở `BaseMetalPriceHistory` với cờ
  `(baseMetalId, isActive)` cho dòng đang dùng; công thức lãi ở `PricingFormula`;
  VAT/tiền công chuẩn ở `ProductCategory`. Bảng `PricingConfig` một dòng toàn cục
  đã bị xoá — không tái lập kiểu thiết kế này.
- **Không tạo FK vòng tròn / FK song phương** giữa hai bảng kể cả khi kỹ thuật cho
  phép. Giá trị suy diễn được cache (ví dụ `QuoteRequest.finalOptionId` /
  `finalPrice`) giữ dạng cột scalar thuần, không khai báo quan hệ Prisma; đồng bộ
  bằng DB trigger.
- **Chống race condition** bằng cập nhật có điều kiện: dùng `updateMany({ where:
  { id, status: EXPECTED }, ... })` rồi kiểm tra `count === 1`, hoặc cột `version`
  (optimistic locking, tăng khi ACCEPT / RESUBMIT). Không đọc-rồi-ghi không khoá
  với các thao tác có thể chạy song song (ví dụ hai Order cùng tiếp nhận một yêu
  cầu).
- Ghi nhiều bản ghi liên quan trong một `$transaction`; với lô lớn ưu tiên
  `createMany` phẳng (tự sinh `id` bằng `randomUUID()`) thay vì nested-create của
  Prisma để giảm số câu lệnh qua pooler.
- Thêm `@@index` cho mọi cột hay dùng trong `where` / `orderBy` (đặc biệt
  `status`, `requesterId`, `assigneeId`, các khoá gộp nhóm `dedupKey`,
  `libraryGroupKey`).
- Khoá gộp/định danh sản phẩm (`dedupKey`, `libraryGroupKey`) **tính sẵn lúc ghi**
  option, không tính lại lúc đọc.

### 5.1 Migration

- **Không dùng `prisma migrate dev`**. Schema thay đổi được áp bằng **SQL thô, idem
  potent, chạy tay trong DBeaver**. Thư mục `prisma/migrations/` thường bị xoá —
  không viết code phụ thuộc lịch sử migration.
- Quy trình khi đổi schema: sửa `schema.prisma` → `npx prisma generate` → viết SQL
  `ALTER`/`CREATE ... IF NOT EXISTS` áp lên DB → cập nhật `prisma/seed.ts` nếu cần.
- Các giá trị suy diễn đồng bộ bằng DB trigger (ví dụ `sync_final_option()`) phải
  được ghi lại trong comment schema kèm tên migration tương ứng.

### 5.2 Không chạm

- **Không sửa `qms_be/.env`** (`DATABASE_URL`, `DIRECT_URL`, các khoá kết nối) —
  người quản trị tự quản.
- Không commit secret. Biến bắt buộc khai báo qua `requiredEnv()` /
  `requiredNumberEnv()` trong `common/constants.ts` để app fail sớm khi thiếu.

---

## 6. Tính giá

- Toàn bộ công thức nằm trong `utils/pricing-math.util.ts` (thuần). Service chỉ
  nạp dữ liệu cấu hình từ DB rồi gọi hàm.
- **Không hardcode hành vi theo tên kim loại**. Kim loại nào tra giá spot nào xác
  định qua `Material.baseMetalId` (FK thật tới `BaseMetal`); ra giá bán dùng công
  thức lãi gắn trên `Material.pricingFormula` (`MARGIN_TIERS` hoặc `MULTIPLIER`).
- Tỷ lệ tuổi vàng ở `Material.priceRatioPct`; VAT và tiền công chuẩn ở
  `ProductCategory`. Cập nhật giá/tỷ lệ chính thức **qua dữ liệu DB**, không sửa
  hằng số trong mã.
- Giá đá tính tách riêng khỏi kim loại, luôn dùng công thức `PricingFormula`
  `isDefault = true`.
- Làm tròn giá bán cuối cùng đến bội số **1.000 VNĐ** (`roundToThousand`).
- **Giá trị suy diễn tính ở backend và trả trong response**, không tính lại ở
  React. Frontend chỉ hiển thị.
- Snapshot giá tại thời điểm báo giá (ví dụ `QuoteOptionStone.unitPriceAtQuote`)
  để xem lại đơn cũ ra đúng số tiền dù bảng lookup đã đổi giá.

---

## 7. Định dạng tiền tệ

- Mọi output do backend sinh ra cho người đọc (export Excel, message card Lark,
  báo cáo) phải format tiền bằng `utils/currency.util.ts` → `formatVnd()`
  (`"1.234.567 đ"`), khớp cách frontend hiển thị (`qms_fe/src/utils/currency.ts`).
- API JSON trả số thô (`Decimal`/number); việc format là của lớp trình bày.

---

## 8. Audit log

- Ghi log qua `AuditLogService` (`logAction` / `logActionByUserId`), không
  `prisma.auditLog.create` rải rác.
- **Ghi log không được làm hỏng luồng chính**: `AuditLogService` tự nuốt lỗi
  (chỉ `logger.warn`), không throw.
- Với đường đi nóng (ví dụ nút "Xác nhận & Gửi báo giá"), gọi log kiểu
  fire-and-forget: `void this.auditLog.logAction(...)`.
- Log lưu `actorRole` **snapshot tại thời điểm hành động**; tên actor tra qua quan
  hệ FK lúc đọc. `actorId` là FK `onDelete: SetNull` để giữ log khi tài khoản bị
  xoá.
- Action đặt tên UPPER_SNAKE (`ACCEPT_QUOTE`, `QUOTE_PRICE`, `MARK_CLOSED`,
  `APPROVE_USER`, `LOGIN`...). Chỉ log `LOGIN` bị dọn tự động sau 90 ngày; log
  nghiệp vụ giữ vĩnh viễn.

---

## 9. Thông báo ngoài (Lark / Email)

- Gửi thông báo là **phụ, không chặn nghiệp vụ chính**. Luôn fire-and-forget với
  `.catch(() => {})` hoặc `void`.
- Lỗi tích hợp ngoài (Lark chưa bật bot, SendGrid lỗi...) chỉ được `logger.warn`,
  không làm request nghiệp vụ trả lỗi.
- Cấu hình endpoint/URL bên thứ ba tập trung ở `APP_CONSTANTS`, không rải chuỗi
  URL trong service.
- Luồng báo giá chỉ có **một** thông báo Lark: khi và chỉ khi yêu cầu đã có giá
  thành công (dạng message card, không lộ giá vốn).

---

## 10. Cache

- **Không cache RAM dữ liệu đọc từ DB** (giá kim loại, vật liệu, danh mục, đá,
  công thức tính giá, danh sách yêu cầu báo giá...). Mọi `findAll`/`findMany` cho
  dữ liệu nghiệp vụ luôn query DB trực tiếp mỗi lần gọi — theo chỉ đạo team lead.
  `common/cache-with-ttl.util.ts` (`CacheWithTtl`) và `QuoteListCacheService` đã bị
  xoá khỏi codebase; không tái lập kiểu cache này.
- **Ngoại lệ được chấp nhận** — chỉ cho hạ tầng/đúng đắn kỹ thuật, không phải dữ
  liệu nghiệp vụ:
  - Cache user trong `JwtStrategy` (`userCache`, TTL ngắn qua env
    `JWT_USER_CACHE_TTL_MS`, mặc định 15s) — coi là auth infra, không phải data
    nghiệp vụ; TTL ngắn để khoá/huỷ tài khoản có hiệu lực gần như ngay.
  - Cache `tenant_access_token` của Lark trong `lark.service.ts` — token của API
    ngoài, có `expiresAt` riêng, không phải dữ liệu DB.
- Cache theo instance được chấp nhận cho hệ thống nội bộ; comment rõ nhiều
  instance sẽ stale độc lập tối đa bằng TTL.
- Map cache tự giới hạn kích thước (xoá sạch khi vượt ngưỡng) để không phình vô
  hạn.

---

## 11. Xử lý lỗi

- Ném exception chuẩn của NestJS: `BadRequestException` (input sai),
  `UnauthorizedException` (chưa/không xác thực), `ForbiddenException` (sai
  quyền), `NotFoundException` (không tìm thấy), `ConflictException` (xung đột
  trạng thái / race).
- **Message lỗi viết tiếng Việt**, cụ thể, hướng người dùng
  (`'Yêu cầu này đã được tiếp nhận bởi nhân sự khác'`).
- Không nuốt lỗi im lặng ở luồng nghiệp vụ chính. Ngoại lệ được phép nuốt: ghi
  audit log, gửi thông báo ngoài, cập nhật avatar/metadata phụ.
- Thông báo bảo mật không được làm lộ thông tin (ví dụ forgot-password trả lời
  chung dù email có tồn tại hay không).

---

## 12. Realtime

- Dùng `RealtimeModule` / `realtime.gateway.ts` (Socket.IO) cho cập nhật thời gian
  thực (chat, thay đổi trạng thái). Không dùng polling khi đã có gateway.
- Chat Sale ↔ Order: một `QuoteRequest` = đúng một luồng chat cố định
  (`quoteRequestId` trên message là khoá luồng, không có bảng `Conversation`
  riêng).

---

## 13. Upload file

- Ảnh/video upload lên **Cloudinary** qua `CloudinaryModule`, không lưu file vào
  filesystem server.
- Giới hạn: ảnh `MAX_FILE_SIZE` 10MB, MIME trong `ALLOWED_MIME_TYPES`; video
  `MAX_VIDEO_FILE_SIZE` 100MB, MIME trong `ALLOWED_VIDEO_MIME_TYPES`. Body limit
  toàn cục 50MB (hỗ trợ base64).
- Import Excel tối đa `MAX_IMPORT_ROWS` (1000), export tối đa `MAX_EXPORT_ROWS`
  (5000).

---

## 14. Style & lint

- Format bằng Prettier (`prettier/prettier: error`, `endOfLine: auto`). Chạy
  `npm run lint` (eslint `recommendedTypeChecked`) trước khi merge.
- `@typescript-eslint/no-floating-promises` là **warn** — promise không await phải
  đánh dấu `void` một cách có chủ đích, không để trôi.
- `no-explicit-any` đã tắt; vẫn ưu tiên type cụ thể, chỉ dùng `any` ở ranh giới
  dữ liệu động (payload mapping).
- **Comment giải thích "tại sao", không phải "cái gì"** — theo văn phong hiện có
  trong repo (comment tiếng Việt, nêu lý do kỹ thuật, dẫn tên migration/tài liệu
  nghiệp vụ khi liên quan).
- `strictNullChecks` bật; xử lý `null`/`undefined` tường minh.

---

## 15. Swagger & tài liệu API

- Mỗi endpoint phải có `@ApiOperation({ summary })` mô tả tiếng Việt và
  `@ApiTags` theo nhóm nghiệp vụ.
- Khi đổi route hoặc DTO: cập nhật decorator Swagger **và** `doc/API.md` trong
  cùng thay đổi. Swagger chỉ là mô tả, không phải nguồn sự thật.
- Swagger UI ở `/api/docs`. Prefix API toàn cục là `/api`.

---

## 16. Kiểm tra trước khi merge

```bash
cd qms_be && npm run build      # bắt buộc pass
cd qms_be && npm run lint       # không warning mới
```

- Nếu đổi `schema.prisma`: đã chạy `npx prisma generate`, đã chuẩn bị SQL thô áp
  lên DB, đã cập nhật `seed.ts` nếu cần.
- Nếu đổi tính giá: kiểm tra cả luồng máy tính giá nhanh (Sale) và luồng báo giá
  đầy đủ (Order), và tính lại giá "sống" (`livePrice`) cho option đã lưu.
- Nếu đổi field option: đã cập nhật `stripCostFieldsForSale`,
  `REQUEST_DETAIL_INCLUDE`, `buildOptionCreateInput` và các khoá gộp nhóm.

---

## 17. Git

- **Claude Code / công cụ AI không tự tạo commit, branch, worktree** hay thao tác
  git trong dự án này. Người phát triển tự quản git.
- Commit message **không** kèm trailer `Co-Authored-By: Claude`.
