import {
  AuditAction,
  AUDIT_ACTION_LABELS,
  NOTIFIABLE_ACTION_LIST,
} from '../src/common/audit-actions';

// MARK_CLOSED đã ngừng phát sinh (gỡ tính năng "Đã chốt") nhưng audit_logs cũ và subscription Lark
// đã lưu vẫn tham chiếu tới nó — giữ key + nhãn, chỉ ẩn khỏi checklist cấu hình.
describe('AuditAction.MARK_CLOSED đã ngừng dùng', () => {
  it('checklist Lark không còn mời đăng ký MARK_CLOSED nhưng vẫn có các action đang dùng', () => {
    const actions = NOTIFIABLE_ACTION_LIST.map((a) => a.action);

    expect(actions).not.toContain(AuditAction.MARK_CLOSED);
    expect(actions).toContain(AuditAction.QUOTE_PRICE);
  });

  it('log cũ vẫn hiển thị đúng nhãn tiếng Việt', () => {
    expect(AUDIT_ACTION_LABELS[AuditAction.MARK_CLOSED]).toBe(
      'Đánh dấu đã chốt',
    );
  });

  it('key vẫn còn trong enum để audit_logs cũ và subscription đã lưu hợp lệ', () => {
    expect(Object.values(AuditAction)).toContain('MARK_CLOSED');
  });
});
