import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  APP_CONSTANTS,
  CANCELLABLE_QUOTE_STATUSES,
  FILTERABLE_QUOTE_STATUSES,
} from '../src/common/constants';
import { QuoteAction } from '../src/quote-requests/dto/update-quote-status.dto';
import { FilterQuoteRequestDto } from '../src/quote-requests/dto/filter-quote-request.dto';

describe('Trạng thái CANCELLED — hằng số và DTO', () => {
  it('được phép lọc theo CANCELLED ở API danh sách', () => {
    expect(FILTERABLE_QUOTE_STATUSES).toContain('CANCELLED');
  });

  it('có nhãn tiếng Việt "Đã hủy"', () => {
    expect(APP_CONSTANTS.QUOTE_STATUS_LABELS.CANCELLED).toBe('Đã hủy');
  });

  it('chỉ hủy được từ 4 trạng thái đang mở (không REJECTED, không CANCELLED)', () => {
    expect([...CANCELLABLE_QUOTE_STATUSES].sort()).toEqual(
      ['NEED_MORE_INFO', 'PENDING', 'PROCESSING', 'QUOTED'].sort(),
    );
  });

  it('QuoteAction có CANCEL và RESTORE', () => {
    expect(QuoteAction.CANCEL).toBe('CANCEL');
    expect(QuoteAction.RESTORE).toBe('RESTORE');
  });

  it('DTO danh sách chấp nhận status=CANCELLED nhưng vẫn từ chối CLOSED', async () => {
    const ok = plainToInstance(FilterQuoteRequestDto, { status: 'CANCELLED' });
    expect(await validate(ok)).toHaveLength(0);

    const bad = plainToInstance(FilterQuoteRequestDto, { status: 'CLOSED' });
    expect(await validate(bad)).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 3 — helper hiển thị đơn hủy + scope của buildQuoteWhereClause + bộ đếm
// ---------------------------------------------------------------------------------------------
import { Role } from '@prisma/client';
import {
  NOT_CANCELLED_WHERE,
  canSeeCancelledQuotes,
  notCancelledSql,
  quoteVisibilityWhere,
} from '../src/utils/quote-visibility.util';
import { buildQuoteWhereClause } from '../src/utils/quote-filter.util';
import {
  countsFromGroupBy,
  getMyReqCount,
} from '../src/utils/quote-counts.util';

const NOT_CANCELLED = { status: { not: 'CANCELLED' } };

// Tìm {status:{not:'CANCELLED'}} ở bất kỳ độ sâu nào của cây where (AND/OR lồng nhau).
function hasNotCancelled(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasNotCancelled);
  if (JSON.stringify(node.status) === JSON.stringify({ not: 'CANCELLED' })) {
    return true;
  }
  return Object.values(node).some(hasNotCancelled);
}

const user = (role: Role) => ({ id: `u-${role}`, role }) as any;

describe('quote-visibility.util', () => {
  it('chỉ ADMIN được thấy đơn hủy; role vắng = coi như không được', () => {
    expect(canSeeCancelledQuotes(Role.ADMIN)).toBe(true);
    expect(canSeeCancelledQuotes(Role.SALE)).toBe(false);
    expect(canSeeCancelledQuotes(Role.ORDER)).toBe(false);
    expect(canSeeCancelledQuotes(undefined)).toBe(false);
    expect(canSeeCancelledQuotes(null)).toBe(false);
  });

  it('quoteVisibilityWhere: ADMIN không bị lọc, mọi trường hợp khác loại CANCELLED', () => {
    expect(quoteVisibilityWhere(Role.ADMIN)).toEqual({});
    expect(quoteVisibilityWhere(Role.SALE)).toEqual(NOT_CANCELLED);
    expect(quoteVisibilityWhere(Role.ORDER)).toEqual(NOT_CANCELLED);
    expect(quoteVisibilityWhere(undefined)).toEqual(NOT_CANCELLED);
    expect(NOT_CANCELLED_WHERE).toEqual(NOT_CANCELLED);
  });

  it('notCancelledSql gắn alias vào điều kiện SQL thô', () => {
    expect(notCancelledSql('qr').sql).toBe("qr.status <> 'CANCELLED'");
    expect(notCancelledSql('qr2').sql).toBe("qr2.status <> 'CANCELLED'");
  });

  it('notCancelledSql từ chối alias có thể chèn SQL', () => {
    expect(() => notCancelledSql('qr; DROP TABLE x')).toThrow();
    expect(() => notCancelledSql('')).toThrow();
  });
});

describe('buildQuoteWhereClause — scope và quyền thấy đơn hủy', () => {
  it('SALE và ORDER ở scope list: luôn loại CANCELLED', () => {
    for (const role of [Role.SALE, Role.ORDER]) {
      expect(hasNotCancelled(buildQuoteWhereClause({}, user(role), 'list'))).toBe(true);
    }
  });

  it('non-admin gửi status=CANCELLED: điều kiện giao nhau rỗng (không lộ đơn hủy)', () => {
    const where: any = buildQuoteWhereClause(
      { status: 'CANCELLED' } as any,
      user(Role.SALE),
      'list',
    );
    expect(where.AND).toContainEqual({ status: 'CANCELLED' });
    expect(hasNotCancelled(where)).toBe(true);
  });

  it('ADMIN ở scope list không chọn status: loại CANCELLED (đơn hủy chỉ hiện ở tab Đã hủy)', () => {
    expect(hasNotCancelled(buildQuoteWhereClause({}, user(Role.ADMIN), 'list'))).toBe(true);
  });

  it('ADMIN ở scope list với status=CANCELLED: chỉ lấy đơn hủy, không có điều kiện loại', () => {
    const where: any = buildQuoteWhereClause(
      { status: 'CANCELLED' } as any,
      user(Role.ADMIN),
      'list',
    );
    expect(where.AND).toContainEqual({ status: 'CANCELLED' });
    expect(hasNotCancelled(where)).toBe(false);
  });

  it('scope tabCounts: ADMIN không bị loại (để groupBy trả nhóm CANCELLED), non-admin vẫn bị loại', () => {
    expect(hasNotCancelled(buildQuoteWhereClause({}, user(Role.ADMIN), 'tabCounts'))).toBe(false);
    expect(hasNotCancelled(buildQuoteWhereClause({}, user(Role.SALE), 'tabCounts'))).toBe(true);
    expect(hasNotCancelled(buildQuoteWhereClause({}, user(Role.ORDER), 'tabCounts'))).toBe(true);
  });

  it('scope totals (thống kê/dashboard): loại cho MỌI role, kể cả ADMIN gửi status=CANCELLED', () => {
    for (const role of [Role.ADMIN, Role.SALE, Role.ORDER]) {
      expect(
        hasNotCancelled(
          buildQuoteWhereClause({ status: 'CANCELLED' } as any, user(role), 'totals'),
        ),
      ).toBe(true);
    }
  });

  it('không truyền scope = totals (mặc định an toàn nhất)', () => {
    expect(hasNotCancelled(buildQuoteWhereClause({}, user(Role.ADMIN)))).toBe(true);
  });

  it('SALE gõ "hủy" vào ô tìm kiếm (khớp nhãn "Đã hủy"): nhánh khớp trạng thái vẫn bị AND chặn', () => {
    const where: any = buildQuoteWhereClause(
      { search: 'hủy' } as any,
      user(Role.SALE),
      'list',
    );
    const searchOr = where.AND.find((c: any) => Array.isArray(c.OR) && c.OR.some((o: any) => o.code));
    expect(searchOr.OR).toContainEqual({ status: { in: ['CANCELLED'] } });
    // điều kiện loại nằm ở một phần tử AND RIÊNG, nên giao với nhánh trên cho kết quả rỗng
    expect(where.AND).toContainEqual(NOT_CANCELLED);
  });
});

describe('quote-counts — đơn hủy không vào tổng', () => {
  it('countsFromGroupBy: có field cancelled nhưng total không cộng đơn hủy', () => {
    const counts = countsFromGroupBy(
      [
        { status: 'CANCELLED', _count: { _all: 3 } },
        { status: 'QUOTED', _count: { _all: 2 } },
        { status: 'PENDING', _count: { _all: 1 } },
      ] as any,
      0,
    );
    expect(counts.cancelled).toBe(3);
    expect(counts.total).toBe(3);
    expect(counts.quoted).toBe(2);
  });

  it('countsFromGroupBy: không có nhóm CANCELLED → cancelled = 0', () => {
    expect(countsFromGroupBy([], 0).cancelled).toBe(0);
  });

  it.each([Role.SALE, Role.ORDER, Role.ADMIN])(
    'getMyReqCount (%s) luôn loại đơn hủy',
    async (role) => {
      const prisma: any = { quoteRequest: { count: jest.fn().mockResolvedValue(0) } };
      await getMyReqCount(prisma, user(role));
      const { where } = prisma.quoteRequest.count.mock.calls[0][0];
      expect(hasNotCancelled(where)).toBe(true);
    },
  );
});
