import {
  AuditAction,
  AUDIT_ACTION_LABELS,
  NOTIFIABLE_ACTION_LIST,
  ADMIN_ONLY_AUDIT_ACTIONS,
  ADMIN_ONLY_AUDIT_ACTION_LABELS,
} from '../src/common/audit-actions';

describe('Hủy / khôi phục yêu cầu — audit action chỉ dành cho ADMIN', () => {
  const hidden = ['CANCEL_QUOTE', 'RESTORE_QUOTE'];

  it('KHÔNG nằm trong enum AuditAction, nhãn Lark hay checklist Lark (nếu lọt vào sẽ có thể bắn thẻ Lark lộ đơn đã hủy)', () => {
    for (const action of hidden) {
      expect(Object.values(AuditAction)).not.toContain(action);
      expect(Object.keys(AUDIT_ACTION_LABELS)).not.toContain(action);
      expect(NOTIFIABLE_ACTION_LIST.map((a) => a.action)).not.toContain(action);
    }
  });

  it('có hằng riêng và nhãn tiếng Việt', () => {
    expect(ADMIN_ONLY_AUDIT_ACTIONS.CANCEL_QUOTE).toBe('CANCEL_QUOTE');
    expect(ADMIN_ONLY_AUDIT_ACTIONS.RESTORE_QUOTE).toBe('RESTORE_QUOTE');
    expect(ADMIN_ONLY_AUDIT_ACTION_LABELS.CANCEL_QUOTE).toBe(
      'Hủy yêu cầu báo giá',
    );
    expect(ADMIN_ONLY_AUDIT_ACTION_LABELS.RESTORE_QUOTE).toBe(
      'Khôi phục yêu cầu báo giá',
    );
  });
});

describe('AuditAction — đã gỡ MARK_CLOSED', () => {
  it('enum, nhãn và checklist Lark không còn MARK_CLOSED', () => {
    expect(Object.values(AuditAction)).not.toContain('MARK_CLOSED');
    expect(Object.keys(AUDIT_ACTION_LABELS)).not.toContain('MARK_CLOSED');
    expect(NOTIFIABLE_ACTION_LIST.map((a) => a.action)).not.toContain(
      'MARK_CLOSED',
    );
  });

  it('checklist Lark vẫn có các action đang dùng', () => {
    expect(NOTIFIABLE_ACTION_LIST.map((a) => a.action)).toContain(
      AuditAction.QUOTE_PRICE,
    );
  });
});
