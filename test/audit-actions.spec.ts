import {
  AuditAction,
  AUDIT_ACTION_LABELS,
  NOTIFIABLE_ACTION_LIST,
} from '../src/common/audit-actions';

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
