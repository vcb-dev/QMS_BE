# API Reference — Backend (qms_be)

Liệt kê toàn bộ endpoint REST hiện có trong `qms_be/src`, nhóm theo module, kèm
quyền truy cập và chức năng. Base URL: `http://<host>:<PORT>/api`. Swagger UI:
`/api/docs`.

Cột **Quyền** ghi guard/role thực tế đang gắn trong code (không phải khuyến
nghị) — `Public` = không cần đăng nhập, `JWT` = cần đăng nhập nhưng không giới
hạn role, `JWT + Roles(...)` = cần đăng nhập và đúng role liệt kê.

---

## Auth (`/auth`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| POST | `/auth/login` | Public (SkipCsrf, throttle riêng) | Đăng nhập, set cookie HttpOnly `crmspd_at`/`crmspd_rt` |
| POST | `/auth/refresh` | Public | Refresh token — rotation bắt buộc, sinh cặp token mới |
| POST | `/auth/logout` | Public | Đăng xuất, thu hồi refresh token, xoá cookie |
| POST | `/auth/register` | Public (SkipCsrf) | Đăng ký tài khoản mới (vào trạng thái chờ ADMIN duyệt) |
| POST | `/auth/forgot-password` | Public (SkipCsrf, throttle riêng) | Gửi OTP đặt lại mật khẩu qua email |
| POST | `/auth/reset-password` | Public (SkipCsrf, throttle riêng) | Đặt lại mật khẩu bằng OTP |
| GET | `/auth/lark` | Public (SkipCsrf, throttle riêng) | Redirect sang trang OAuth của Lark để đăng nhập bằng Lark |
| GET | `/auth/lark/callback` | Public (SkipCsrf) | Callback OAuth Lark, đối chiếu `state` chống CSRF rồi login |
| GET | `/auth/profile` | JWT | Lấy thông tin user hiện tại từ token |

---

## Users (`/users`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/users` | JWT | Danh sách tất cả người dùng |
| GET | `/users/pending` | JWT + Roles(ADMIN) | Danh sách tài khoản chờ phê duyệt |
| GET | `/users/stats` | JWT | Thống kê người dùng (tổng số, theo role, theo bộ phận, chờ duyệt) |
| GET | `/users/:id` | JWT | Chi tiết 1 người dùng |
| PATCH | `/users/:id/approve` | JWT + Roles(ADMIN) | Phê duyệt tài khoản, có thể gán role lúc duyệt |
| DELETE | `/users/:id/reject` | JWT + Roles(ADMIN) | Từ chối và xoá tài khoản đang chờ duyệt |
| PATCH | `/users/:id/active` | JWT + Roles(ADMIN) | Khoá / mở khoá tài khoản |

---

## Departments (`/departments`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/departments` | JWT | Danh sách phòng ban |
| POST | `/departments` | JWT + Roles(ADMIN) | Tạo phòng ban mới |

---

## Materials (`/materials`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/materials` | JWT | Danh sách chất liệu (vàng/bạc theo tuổi) |
| POST | `/materials` | JWT + Roles(ADMIN) | Thêm chất liệu mới, gắn kim loại gốc + công thức lãi |
| PATCH | `/materials/:id` | JWT + Roles(ORDER, ADMIN) | Sửa tỷ lệ tuổi (`priceRatioPct`), công thức lãi, kim loại gốc |

Không có endpoint xoá — chất liệu là bảng lookup, ẩn khỏi dropdown bằng cờ
`isActive` qua service, không xoá cứng.

---

## Pricing Formulas (`/pricing-formulas`)

Toàn controller yêu cầu `Roles(ORDER, ADMIN)` — lộ cấu tạo giá vốn/lợi nhuận
nên Sale không được xem.

| Method | Path | Chức năng |
| --- | --- | --- |
| GET | `/pricing-formulas` | Danh sách công thức tính lãi (`MARGIN_TIERS` / `MULTIPLIER`) |
| POST | `/pricing-formulas` | Tạo công thức mới |
| PATCH | `/pricing-formulas/:id` | Sửa công thức / đặt làm mặc định |

---

## Stones (`/stones`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/stones` | JWT | Danh sách đá quý, lọc theo `stoneType` |
| POST | `/stones` | JWT + Roles(ORDER, ADMIN) | Thêm 1 loại đá |
| POST | `/stones/import` | JWT + Roles(ORDER, ADMIN) | Import bảng giá đá từ file Excel (.xlsx/.xls, ≤5MB) |
| PUT | `/stones/:id` | JWT + Roles(ORDER, ADMIN) | Sửa thông tin 1 loại đá |
| PATCH | `/stones/prices` | JWT + Roles(ORDER, ADMIN) | Lưu giá nhiều viên đá cùng lúc |
| DELETE | `/stones/:id` | JWT + Roles(ORDER, ADMIN) | Xoá 1 loại đá |
| POST | `/stones/delete-many` | JWT + Roles(ORDER, ADMIN) | Xoá nhiều loại đá cùng lúc |

---

## Product Categories (`/product-categories`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/product-categories` | JWT | Danh sách danh mục sản phẩm |
| POST | `/product-categories` | JWT + Roles(ORDER, ADMIN) | Tạo danh mục mới kèm tiền công/VAT chuẩn |
| PATCH | `/product-categories/bulk` | JWT + Roles(ORDER, ADMIN) | Sửa tiền công/VAT nhiều danh mục trong 1 lần gọi |
| PATCH | `/product-categories/:id` | JWT + Roles(ORDER, ADMIN) | Sửa tiền công/VAT 1 danh mục |
| DELETE | `/product-categories/:id` | JWT + Roles(ORDER, ADMIN) | Xoá 1 danh mục |
| POST | `/product-categories/delete-many` | JWT + Roles(ORDER, ADMIN) | Xoá nhiều danh mục cùng lúc |

---

## Customers (`/customers`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/customers` | JWT | Danh sách khách hàng, có tìm kiếm |
| GET | `/customers/stats` | JWT | Thống kê theo khách hàng (tổng đơn/đã chốt/giá trị/đơn gần nhất) |
| GET | `/customers/stats/month-comparison` | JWT | So sánh KPI khách hàng tháng này với tháng trước |
| GET | `/customers/:id` | JWT | Chi tiết khách hàng |
| POST | `/customers` | JWT | Tạo khách hàng mới |
| PATCH | `/customers/:id` | JWT | Cập nhật khách hàng |
| DELETE | `/customers/:id` | JWT | Xoá khách hàng |

---

## Quote Requests (`/quote-requests`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| POST | `/quote-requests` | JWT + Roles(SALE, ADMIN) | Tạo yêu cầu báo giá mới, tự upload ảnh/video lên Cloudinary |
| GET | `/quote-requests` | JWT | Danh sách yêu cầu báo giá, lọc + phân trang |
| GET | `/quote-requests/stats` | JWT | Số liệu tổng hợp (đếm & doanh thu) theo bộ lọc, không kéo item |
| GET | `/quote-requests/dashboard-charts` | JWT | Dữ liệu 6 biểu đồ Dashboard (timeline, xếp hạng Sale, phân bố danh mục/chất liệu/giá, sản phẩm nổi bật) |
| GET | `/quote-requests/staff-performance` | JWT | Hiệu suất Sale (tổng đơn/chốt/tỷ lệ) + hiệu suất người báo giá |
| GET | `/quote-requests/library-products` | JWT + Roles(SALE, ORDER, ADMIN) | Thư viện sản phẩm đã báo giá, gộp theo `libraryGroupKey` |
| GET | `/quote-requests/library-history` | JWT + Roles(SALE, ORDER, ADMIN) | Lịch sử báo giá của 1 sản phẩm trong thư viện |
| GET | `/quote-requests/export` | JWT + Roles(ORDER, ADMIN) | Export danh sách yêu cầu ra file Excel |
| GET | `/quote-requests/:id` | JWT | Chi tiết 1 yêu cầu báo giá |
| PATCH | `/quote-requests/:id` | JWT + Roles(SALE, ADMIN) | Cập nhật yêu cầu báo giá |
| DELETE | `/quote-requests/:id` | JWT + Roles(SALE, ADMIN) | Huỷ yêu cầu báo giá |
| PATCH | `/quote-requests/:id/status` | JWT + Roles(SALE, ORDER, ADMIN) | Chuyển trạng thái tập trung: `ACCEPT`, `QUOTE`, `REJECT`, `RETURN`, `RESUBMIT`, `SELECT_OPTION`, `QUICK_APPROVE`, `QUICK_REJECT` — mỗi `action` tự kiểm quyền chi tiết trong `QuoteWorkflowService` |
| DELETE | `/quote-requests/:id/options/:optionId` | JWT + Roles(ORDER, ADMIN) | Xoá 1 phương án báo giá không muốn đề xuất |

> `library-products`/`library-history` nằm ở `LibraryController` riêng nhưng
> chung prefix `/quote-requests`, đăng ký trước để không bị route `:id` nuốt mất.

---

## Quote Options — tính giá (`/quote-options`)

Yêu cầu JWT (không giới hạn role — Sale/Order/Admin đều gọi được, nhưng
response bị lọc theo role trong service).

| Method | Path | Chức năng |
| --- | --- | --- |
| GET | `/quote-options/silver-multipliers` | Danh sách hệ số nhân bạc để chọn lúc báo giá |
| POST | `/quote-options/calculate` | Tính giá 1 phương án (máy tính giá nhanh, chưa lưu DB) |
| POST | `/quote-options/calculate-multi` | Tính giá 1 phương án nhiều chất liệu phối hợp |
| POST | `/quote-options/calculate-batch` | Tính nhiều phương án (chính + các loại vàng khác) trong 1 request |

Với role `SALE`: tiền công/VAT bị ép theo danh mục sản phẩm (không tự nhập),
không được chọn hệ số nhân bạc, và response bị cắt còn `quotedPrice` +
`materialPrice` + `stonePrice` — ẩn toàn bộ cấu thành giá vốn.

---

## Quote Chat (`/quote-chat`)

Yêu cầu JWT. Một `QuoteRequest` = đúng một luồng chat Sale ↔ Order.

| Method | Path | Chức năng |
| --- | --- | --- |
| GET | `/quote-chat/:quoteRequestId/messages` | Lấy lịch sử chat của 1 yêu cầu báo giá |
| POST | `/quote-chat/:quoteRequestId/upload-image` | Upload ảnh đính kèm tin nhắn lên Cloudinary |

Tin nhắn realtime gửi/nhận qua Socket.IO (`RealtimeModule`), không qua REST.

---

## Metal Prices (`/metal-prices`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/metal-prices` | JWT + Roles(ORDER, ADMIN) | Danh mục kim loại gốc kèm giá hiện tại |
| GET | `/metal-prices/history` | JWT + Roles(ORDER, ADMIN) | Lịch sử đổi giá, lọc theo `baseMetalId` |
| POST | `/metal-prices` | JWT + Roles(ADMIN) | Thêm kim loại gốc mới |
| PATCH | `/metal-prices/:id/active` | JWT + Roles(ADMIN) | Ngừng dùng / bật lại 1 kim loại gốc (không xoá cứng) |
| PATCH | `/metal-prices/:id/price` | JWT + Roles(ORDER, ADMIN) | Cập nhật giá — tạo dòng lịch sử mới, không sửa đè dòng cũ |

Sale không được xem endpoint này (chỉ Order/Admin) vì lộ giá vốn kim loại.

---

## VN Gold Price (`/vn-gold-price`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/vn-gold-price` | Public | Giá vàng thị trường tham khảo từ nguồn ngoài (không phải giá cấu hình nội bộ) |

---

## Locations (`/locations`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/locations/provinces` | Public | Danh sách Tỉnh/Thành phố Việt Nam |
| GET | `/locations/wards` | Public | Danh sách Xã/Phường theo Tỉnh (truyền `provinceId` hoặc `provinceName`) |

---

## Lark Webhooks (`/lark-webhooks`)

Toàn controller yêu cầu `Roles(ADMIN)` — cấu hình thông báo ra ngoài chỉ Admin
được đụng vào.

| Method | Path | Chức năng |
| --- | --- | --- |
| GET | `/lark-webhooks/actions` | Danh mục hành động có thể đăng ký nhận thông báo |
| GET | `/lark-webhooks/updaters` | Danh sách người từng cập nhật webhook |
| GET | `/lark-webhooks/dm-bridge` | Trạng thái cầu trả lời qua Lark DM |
| GET | `/lark-webhooks` | Danh sách webhook Lark, lọc + phân trang |
| POST | `/lark-webhooks` | Thêm webhook mới |
| PATCH | `/lark-webhooks/dm-bridge` | Bật/tắt cầu trả lời qua Lark DM |
| PATCH | `/lark-webhooks/:id` | Cập nhật webhook |
| DELETE | `/lark-webhooks/:id` | Xoá webhook |
| POST | `/lark-webhooks/:id/test` | Gửi tin thử qua webhook |

---

## Audit Log (`/audit-log`)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/audit-log/stats` | JWT + Roles(ADMIN) | Đếm số lần mỗi hành động, nhóm theo role |

---

## App (root)

| Method | Path | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/` | Public | Health-check tĩnh mặc định của NestJS |
| GET | `/health` | Public | Health-check thật — ping `SELECT 1` xuống DB |

---

## Không có route REST riêng

- **Cloudinary** (`CloudinaryModule`) — service dùng nội bộ để upload ảnh/video
  (gọi từ `quote-requests`, `quote-chat`), không có controller riêng.
- **Mail** (`MailModule`) — service gửi email nội bộ (OTP, thông báo), không có
  controller riêng.
- **Excel** (`ExcelModule`) — service dựng file `.xlsx`, được gọi từ
  `GET /quote-requests/export`, không có controller riêng.
- **Realtime** (`RealtimeModule` / `realtime.gateway.ts`) — Socket.IO cho chat
  và cập nhật trạng thái thời gian thực, không phải REST.
