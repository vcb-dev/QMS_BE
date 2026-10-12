import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// TRIPWIRE cho quy tắc "đơn đã hủy chỉ ADMIN thấy". Rủi ro lớn nhất của tính năng là SÓT một đường đọc
// `quote_requests` (Prisma, SQL thô, đọc lồng) → lộ đơn hủy cho Sale/Order. Mỗi đường đọc hiện có đã
// được rà và có test chốt riêng (xem chú thích bên dưới). Test này đếm các đường đọc trong src/ và đỏ
// khi số đếm đổi — buộc người thêm/đổi một đường đọc phải áp quy tắc hủy
// (src/utils/quote-visibility.util.ts), viết test chốt, rồi mới cập nhật bảng kiểm kê này.

const SRC = join(__dirname, '..', 'src');

// Đọc một bản ghi/nhiều bản ghi qua delegate `quoteRequest` (kể cả tx.quoteRequest).
const PRISMA_READ =
  /quoteRequest\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|groupBy|aggregate)\(/g;
// Đọc qua quan hệ: include/select/_count lồng (`quoteRequest(s): …`) và các quan hệ ngược của User.
const RELATION_READ =
  /\b(quoteRequests?|requestedQuotes|assignedQuotes|assignedOrderQuotes)\s*:/g;
// SQL thô nhắc tới bảng quote_requests.
const RAW_TABLE = /\bquote_requests\b/g;
// File có dùng SQL thô nói chung (kể cả khi không nhắc quote_requests ở dạng chữ).
const RAW_CALL = /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)/g;

// ---- Bảng kiểm kê (đường dẫn tính từ src/) ----------------------------------------------------
const EXPECTED_PRISMA_READS: Record<string, number> = {
  // onWebMessage dựng thẻ DM cho tin vừa lưu; tin chỉ sinh ra từ saveMessage (đã chặn đơn hủy).
  'lark/lark.service.ts': 1,
  // assertParticipant (cổng chat: đơn hủy → Forbidden với non-admin) + getUnreadCounts (quoteVisibilityWhere).
  'quote-chat/quote-chat.service.ts': 2,
  // hydrateRequests: ép status QUOTED.
  'quote-requests/library/library.service.ts': 1,
  // update, remove (guard đơn hủy) + 2 groupBy của pickAssignedOrderId (NOT_CANCELLED_WHERE).
  'quote-requests/quote-requests.service.ts': 4,
  // getStats/getDashboardCharts (buildQuoteWhereClause 'totals') + getStaffPerformance (NOT_CANCELLED_WHERE).
  'quote-requests/quote/quote-analytics.service.ts': 11,
  // findAll (items, count, groupBy tab) + findAllForExport + findOne: scope 'list'/'tabCounts'/quoteVisibilityWhere.
  'quote-requests/quote/quote-query.service.ts': 5,
  // 11 lần đọc cũ chỉ chạy SAU guard trung tâm ở đầu updateStatus (+1 = chính guard); deleteOption gấp guard vào truy vấn của nó.
  'quote-requests/quote/quote-workflow.service.ts': 12,
  // getMyReqCount: NOT_CANCELLED_WHERE.
  'utils/quote-counts.util.ts': 1,
};

const EXPECTED_RELATION_READS: Record<string, number> = {
  // findOne: quoteRequests lồng có where NOT_CANCELLED_WHERE.
  'customers/customers.service.ts': 1,
  // _count.quoteRequests có where NOT_CANCELLED_WHERE.
  'departments/departments.service.ts': 1,
  // 2 lần tra quoteChatRead.findFirst để định tuyến reply từ Lark: quoteRequest: NOT_CANCELLED_WHERE.
  'lark/lark.service.ts': 2,
  // phương án nổi bật: where.quoteRequest NOT_CANCELLED_WHERE + select quoteRequest (id đã lọc).
  'quote-requests/quote/quote-analytics.service.ts': 2,
};

const EXPECTED_RAW_TABLE_MENTIONS: Record<string, number> = {
  // 3 câu: LEFT JOIN (ON … notCancelledSql), EXISTS theo Sale (notCancelledSql('qr2')), đếm khách tháng (notCancelledSql).
  'customers/customers.service.ts': 3,
  // Thư viện: `qr.status = 'QUOTED'`.
  'quote-requests/library/library.service.ts': 1,
};

const EXPECTED_RAW_CALL_FILES = [
  'app.controller.ts', // SELECT 1 (health check) — không đọc đơn
  'customers/customers.service.ts',
  'quote-requests/library/library.service.ts',
  'quote-requests/quote-requests.service.ts', // pg_advisory_xact_lock — không đọc đơn
];
// -----------------------------------------------------------------------------------------------

// Bỏ dòng chú thích để câu chữ mô tả không bị đếm nhầm.
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

export function countMatches(text: string, re: RegExp): number {
  return (stripComments(text).match(re) ?? []).length;
}

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listTsFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

function inventory(re: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of listTsFiles(SRC)) {
    const n = countMatches(readFileSync(file, 'utf8'), re);
    if (n > 0) out[relative(SRC, file)] = n;
  }
  return out;
}

const HOW_TO_FIX =
  'Đường đọc đơn báo giá mới hoặc đã đổi. Áp quy tắc đơn đã hủy (src/utils/quote-visibility.util.ts: ' +
  'NOT_CANCELLED_WHERE / quoteVisibilityWhere / notCancelledSql / buildQuoteWhereClause), thêm test chốt ' +
  'rằng SALE/ORDER không thấy đơn CANCELLED, RỒI MỚI cập nhật bảng kiểm kê trong test/cancelled-read-paths.spec.ts.';

function expectInventory(
  label: string,
  actual: Record<string, number>,
  expected: Record<string, number>,
) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  const diffs = [...keys]
    .filter((k) => (actual[k] ?? 0) !== (expected[k] ?? 0))
    .map((k) => `  ${k}: đã kiểm kê ${expected[k] ?? 0}, hiện có ${actual[k] ?? 0}`);
  if (diffs.length > 0) {
    throw new Error(`[${label}]\n${diffs.join('\n')}\n${HOW_TO_FIX}`);
  }
}

describe('kiểm kê đường đọc yêu cầu báo giá (đơn đã hủy chỉ ADMIN thấy)', () => {
  it('Prisma: số lần đọc qua quoteRequest.* theo từng file khớp bảng đã rà', () => {
    expectInventory('Prisma delegate', inventory(PRISMA_READ), EXPECTED_PRISMA_READS);
  });

  it('đọc lồng/quan hệ (include, select, _count, quan hệ ngược) khớp bảng đã rà', () => {
    expectInventory('Quan hệ lồng', inventory(RELATION_READ), EXPECTED_RELATION_READS);
  });

  it('SQL thô nhắc tới bảng quote_requests khớp bảng đã rà', () => {
    expectInventory('SQL thô', inventory(RAW_TABLE), EXPECTED_RAW_TABLE_MENTIONS);
  });

  it('chỉ các file đã rà mới dùng $queryRaw/$executeRaw', () => {
    const files = Object.keys(inventory(RAW_CALL)).sort();
    expect(files).toEqual([...EXPECTED_RAW_CALL_FILES].sort());
  });

  it('công cụ đếm: bỏ qua chú thích, đếm đúng cả tx.quoteRequest', () => {
    const sample = [
      '// this.prisma.quoteRequest.findMany({})',
      '/* quoteRequest.count( */',
      'const a = await this.prisma.quoteRequest.findMany({});',
      'const b = await tx.quoteRequest.groupBy({});',
    ].join('\n');
    expect(countMatches(sample, PRISMA_READ)).toBe(2);
  });
});
