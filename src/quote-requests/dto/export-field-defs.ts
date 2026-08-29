import { APP_CONSTANTS } from '../../common/constants';
import { formatVnd } from '../../utils/currency.util';

const NONE = 'Chưa có';

// Text field rỗng/null -> 'Chưa có'. Không dùng cho field số (0 phải giữ nguyên là 0, không phải "chưa có").
function orNone(v: string | null | undefined): string {
  return v ? v : NONE;
}

// vat/quotedPrice/closeRatePct là Prisma Decimal — object, không phải number thường, SheetJS không
// serialize được nên ô bị trống trơn nếu để nguyên. Phải ép Number() trước khi ghi Excel.
// 0 là giá trị hợp lệ (giữ nguyên), chỉ null/undefined mới thành 'Chưa có'.
function decimalOrNone(v: unknown): number | string {
  if (v === null || v === undefined) return NONE;
  return Number(v);
}

// Whitelist cột export Excel — key dùng trong query ?fields=, header là tên cột hiển thị,
// value(item) lấy dữ liệu từ 1 dòng đã sanitize (QuoteQueryService.findAllForExport()).
// FE giữ danh sách key/label song song ở qms_fe/src/constants/exportFields.ts — đổi ở đây nhớ đổi cả bên đó.
export const EXPORT_FIELD_DEFS: {
  key: string;
  header: string;
  value: (item: any) => unknown;
}[] = [
  { key: 'code', header: 'Mã yêu cầu', value: (i) => i.code },
  {
    key: 'status',
    header: 'Trạng thái',
    value: (i) => APP_CONSTANTS.QUOTE_STATUS_LABELS[i.status] || i.status,
  },
  {
    key: 'category',
    header: 'Danh mục',
    value: (i) => orNone(i.category?.name),
  },
  {
    key: 'productName',
    header: 'Sản phẩm',
    value: (i) => orNone(i.productName),
  },
  {
    key: 'material',
    header: 'Chất liệu',
    value: (i) => orNone(i.material?.name),
  },
  {
    key: 'customerName',
    header: 'Khách hàng',
    value: (i) => orNone(i.customer?.name),
  },
  {
    key: 'customerPhone',
    header: 'SĐT khách hàng',
    value: (i) => orNone(i.customer?.phone),
  },
  {
    key: 'requester',
    header: 'Người yêu cầu',
    value: (i) => orNone(i.requester?.name),
  },
  {
    key: 'requesterDept',
    header: 'Phòng ban yêu cầu',
    value: (i) => orNone(i.requester?.department?.name),
  },
  {
    key: 'assignee',
    header: 'Người báo giá',
    value: (i) => orNone(i.assignee?.name),
  },
  {
    key: 'quotedPrice',
    header: 'Giá báo',
    value: (i) => formatVnd(i.quotedPrice),
  },
  {
    key: 'materialPrice',
    header: 'Giá chất liệu',
    value: (i) =>
      i.quotedPrice == null
        ? NONE
        : formatVnd(Number(i.quotedPrice) - Number(i.stonePrice || 0)),
  },
  {
    key: 'stonePrice',
    header: 'Giá đá',
    value: (i) =>
      i.quotedPrice == null ? NONE : formatVnd(i.stonePrice ?? 0),
  },
  { key: 'vat', header: 'VAT (%)', value: (i) => decimalOrNone(i.vat) },
  {
    key: 'quotedDate',
    header: 'Ngày báo giá',
    value: (i) =>
      i.quotedDate ? new Date(i.quotedDate).toLocaleDateString('vi-VN') : NONE,
  },
  {
    key: 'desiredLeadTime',
    header: 'Thời gian mong muốn',
    value: (i) => orNone(i.desiredLeadTime),
  },
  {
    key: 'closeRatePct',
    header: 'Tỉ lệ chốt (%)',
    value: (i) => decimalOrNone(i.closeRatePct),
  },
  {
    key: 'createdAt',
    header: 'Ngày tạo',
    value: (i) =>
      i.createdAt ? new Date(i.createdAt).toLocaleDateString('vi-VN') : NONE,
  },
  {
    key: 'updatedAt',
    header: 'Cập nhật lần cuối',
    value: (i) =>
      i.updatedAt ? new Date(i.updatedAt).toLocaleDateString('vi-VN') : NONE,
  },
];
