/**
 * Danh mục hành động dùng cho cấu hình thông báo Lark — nguồn cho checklist "đăng ký hoạt động"
 * và để tra nhãn tiếng Việt khi dựng thẻ tóm tắt.
 *
 * Chỉ liệt kê action NGHIỆP VỤ có thể muốn gửi thông báo. Các action ghi vết thuần túy, tần suất
 * cao (CALCULATE_PRICE, CALCULATE_PRICE_BATCH...) KHÔNG đưa vào đây — chúng vẫn ghi `audit_logs`
 * bằng literal chuỗi như cũ, chỉ là không ai đăng ký nhận nên dispatch bỏ qua.
 *
 * Cột `audit_logs.action` vẫn là `String` trong Prisma (schema áp dụng bằng SQL tay, enum Postgres
 * gây phiền khi migrate). Enum này chỉ ở tầng ứng dụng.
 *
 * QUY TẮC: chỉ THÊM key mới, không đổi/không xóa giá trị chuỗi cũ — log lịch sử tham chiếu tới nó.
 */
export enum AuditAction {
  // ----- Yêu cầu báo giá (entityType: QuoteRequest) -----
  CREATE_QUOTE = 'CREATE_QUOTE',
  UPDATE_QUOTE = 'UPDATE_QUOTE',
  DELETE_QUOTE = 'DELETE_QUOTE',
  ACCEPT_QUOTE = 'ACCEPT_QUOTE', // Order tiếp nhận xử lý
  QUOTE_PRICE = 'QUOTE_PRICE', // Order gửi báo giá đầy đủ -> trạng thái QUOTED
  QUICK_QUOTE = 'QUICK_QUOTE', // Order nhập giá nhanh, chưa chốt
  QUICK_APPROVE = 'QUICK_APPROVE', // Order duyệt nhanh -> trạng thái QUOTED
  QUICK_REJECT = 'QUICK_REJECT',
  REJECT_QUOTE = 'REJECT_QUOTE',
  RETURN_QUOTE = 'RETURN_QUOTE', // trả lại, yêu cầu Sale bổ sung thông tin
  RESUBMIT_QUOTE = 'RESUBMIT_QUOTE', // Sale gửi lại sau khi bổ sung
  MARK_CLOSED = 'MARK_CLOSED', // Sale đánh dấu Đã chốt
  SELECT_OPTION = 'SELECT_OPTION', // Sale chọn phương án
  DELETE_QUOTE_OPTION = 'DELETE_QUOTE_OPTION',

  // ----- Khách hàng (entityType: Customer) -----
  CREATE_CUSTOMER = 'CREATE_CUSTOMER',
  UPDATE_CUSTOMER = 'UPDATE_CUSTOMER',
  DELETE_CUSTOMER = 'DELETE_CUSTOMER',

  // ----- Nhân viên (entityType: User) -----
  APPROVE_USER = 'APPROVE_USER',
  REJECT_USER = 'REJECT_USER',
  LOCK_USER = 'LOCK_USER',
  UNLOCK_USER = 'UNLOCK_USER',

  // ----- Xuất dữ liệu (endpoint export hiện chưa ghi audit_log — cần thêm 1 dòng logAction) -----
  EXPORT_QUOTE_LIST = 'EXPORT_QUOTE_LIST',
}

/** Nhãn tiếng Việt hiển thị trên thẻ Lark tóm tắt và trên checklist cấu hình. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  [AuditAction.CREATE_QUOTE]: 'Tạo yêu cầu báo giá mới',
  [AuditAction.UPDATE_QUOTE]: 'Cập nhật yêu cầu báo giá',
  [AuditAction.DELETE_QUOTE]: 'Xóa yêu cầu báo giá',
  [AuditAction.ACCEPT_QUOTE]: 'Tiếp nhận xử lý yêu cầu',
  [AuditAction.QUOTE_PRICE]: 'Báo giá hoàn tất',
  [AuditAction.QUICK_QUOTE]: 'Nhập giá nhanh',
  [AuditAction.QUICK_APPROVE]: 'Duyệt nhanh báo giá',
  [AuditAction.QUICK_REJECT]: 'Từ chối nhanh báo giá',
  [AuditAction.REJECT_QUOTE]: 'Từ chối yêu cầu báo giá',
  [AuditAction.RETURN_QUOTE]: 'Trả lại - yêu cầu bổ sung thông tin',
  [AuditAction.RESUBMIT_QUOTE]: 'Gửi lại yêu cầu sau bổ sung',
  [AuditAction.MARK_CLOSED]: 'Đánh dấu đã chốt',
  [AuditAction.SELECT_OPTION]: 'Chọn phương án báo giá',
  [AuditAction.DELETE_QUOTE_OPTION]: 'Xóa phương án báo giá',
  [AuditAction.CREATE_CUSTOMER]: 'Thêm khách hàng',
  [AuditAction.UPDATE_CUSTOMER]: 'Cập nhật khách hàng',
  [AuditAction.DELETE_CUSTOMER]: 'Xóa khách hàng',
  [AuditAction.APPROVE_USER]: 'Duyệt tài khoản nhân viên',
  [AuditAction.REJECT_USER]: 'Từ chối tài khoản nhân viên',
  [AuditAction.LOCK_USER]: 'Khóa tài khoản nhân viên',
  [AuditAction.UNLOCK_USER]: 'Mở khóa tài khoản nhân viên',
  [AuditAction.EXPORT_QUOTE_LIST]: 'Xuất danh sách báo giá ra Excel',
};

/**
 * Action gửi THẺ CHI TIẾT (ảnh sản phẩm + từng phương án + giá chốt), tái dùng buildQuoteCardData.
 * Các action còn lại gửi thẻ tóm tắt generic.
 */
export const RICH_CARD_ACTIONS: ReadonlySet<AuditAction> = new Set([
  AuditAction.QUOTE_PRICE,
  AuditAction.QUICK_APPROVE,
]);

/**
 * Danh sách hoạt động cho ADMIN chọn khi cấu hình webhook. Dùng hằng số này (KHÔNG dùng
 * SELECT DISTINCT action FROM audit_logs) để action mới xuất hiện ngay cả trước lần phát sinh đầu tiên.
 */
export const NOTIFIABLE_ACTIONS: readonly AuditAction[] =
  Object.values(AuditAction);

export interface NotifiableActionInfo {
  action: AuditAction;
  label: string;
  richCard: boolean;
}

/** Payload cho GET /lark-webhooks/actions — FE render checklist. */
export const NOTIFIABLE_ACTION_LIST: readonly NotifiableActionInfo[] =
  NOTIFIABLE_ACTIONS.map((action) => ({
    action,
    label: AUDIT_ACTION_LABELS[action],
    richCard: RICH_CARD_ACTIONS.has(action),
  }));
