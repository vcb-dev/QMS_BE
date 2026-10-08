import { Prisma } from '@prisma/client';
import { QuoteRequestsService } from '../src/quote-requests/quote-requests.service';
import { QuoteQueryService } from '../src/quote-requests/quote/quote-query.service';
import { REQUEST_DETAIL_INCLUDE } from '../src/utils/option-mapper.util';
import { buildQuoteWhereClause } from '../src/utils/quote-filter.util';
import { EXPORT_FIELD_DEFS } from '../src/quote-requests/dto/export-field-defs';

// groupBy được gọi 2 lần: đếm đơn trong ngày (_count) và lấy lần giao gần nhất toàn thời gian (_max).
function makeTx(opts: {
  orders: string[];
  todayCounts?: Record<string, number>;
  lastAssigned?: Record<string, Date>;
}) {
  const { orders, todayCounts = {}, lastAssigned = {} } = opts;
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: {
      findMany: jest.fn().mockResolvedValue(orders.map((id) => ({ id }))),
    },
    quoteRequest: {
      groupBy: jest.fn().mockImplementation((args: any) => {
        if (args._count) {
          return Promise.resolve(
            Object.entries(todayCounts).map(([assignedOrderId, n]) => ({
              assignedOrderId,
              _count: { _all: n },
            })),
          );
        }
        return Promise.resolve(
          Object.entries(lastAssigned).map(([assignedOrderId, createdAt]) => ({
            assignedOrderId,
            _max: { createdAt },
          })),
        );
      }),
      create: jest.fn(),
    },
  };
}

const makeSvc = (deps: Partial<Record<string, any>> = {}) =>
  new QuoteRequestsService(
    deps.prisma ?? ({} as any),
    {} as any,
    deps.queryService ?? ({} as any),
    {} as any,
    deps.auditLog ?? ({} as any),
    {} as any,
    deps.realtimeGateway ?? ({} as any),
    deps.quoteOptionsService ?? ({} as any),
  );

describe('QuoteRequestsService.pickAssignedOrderId — chia đều đơn cho Order theo ngày', () => {
  afterEach(() => jest.useRealTimers());

  it('khoá advisory trước khi đếm, để 2 đơn tạo cùng lúc không cùng chọn một người', async () => {
    const tx = makeTx({ orders: ['a'] });
    await (makeSvc() as any).pickAssignedOrderId(tx);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.findMany.mock.invocationCallOrder[0],
    );
  });

  it('chỉ xét Order đang hoạt động và đã được duyệt', async () => {
    const tx = makeTx({ orders: ['a'] });
    await (makeSvc() as any).pickAssignedOrderId(tx);

    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'ORDER', isActive: true, isApproved: true },
      }),
    );
  });

  it('chọn Order ít đơn nhất trong ngày; người chưa có đơn nào hôm nay tính là 0', async () => {
    const tx = makeTx({
      orders: ['a', 'b', 'c'],
      todayCounts: { a: 2, b: 1 },
    });
    const id = await (makeSvc() as any).pickAssignedOrderId(tx);
    expect(id).toBe('c');
  });

  it('bằng số đơn → chọn người được giao gần nhất cách đây lâu nhất', async () => {
    const tx = makeTx({
      orders: ['a', 'b'],
      todayCounts: { a: 1, b: 1 },
      lastAssigned: {
        a: new Date('2026-10-08T05:00:00Z'),
        b: new Date('2026-10-08T01:00:00Z'),
      },
    });
    const id = await (makeSvc() as any).pickAssignedOrderId(tx);
    expect(id).toBe('b');
  });

  it('chỉ đếm đơn tạo từ 00:00 hôm nay theo giờ Việt Nam', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T17:30:00Z')); // 00:30 ngày 09/10 VN
    const tx = makeTx({ orders: ['a'] });
    await (makeSvc() as any).pickAssignedOrderId(tx);

    const countCall = tx.quoteRequest.groupBy.mock.calls
      .map(([args]: any[]) => args)
      .find((args: any) => args._count);
    expect(countCall.where.createdAt.gte).toEqual(
      new Date('2026-10-08T17:00:00.000Z'),
    );
    expect(countCall.where.assignedOrderId).toEqual({ in: ['a'] });
  });

  it('không có Order hợp lệ → null và không đụng tới bảng yêu cầu', async () => {
    const tx = makeTx({ orders: [] });
    const id = await (makeSvc() as any).pickAssignedOrderId(tx);
    expect(id).toBeNull();
    expect(tx.quoteRequest.groupBy).not.toHaveBeenCalled();
  });
});

describe('QuoteRequestsService.create — ghi người được giao khi tạo đơn', () => {
  const dto = {
    categoryId: 'cat1',
    customerId: 'cust1',
    productName: 'Nhẫn cưới',
  } as any;

  function setup(txs: ReturnType<typeof makeTx>[]) {
    let call = 0;
    const prisma = {
      productCategory: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ laborCost: null, vatRate: null }),
      },
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) =>
        cb(txs[Math.min(call++, txs.length - 1)]),
      ),
    };
    const svc = makeSvc({
      prisma,
      queryService: { stripCostFieldsForSale: jest.fn((o) => o) },
      auditLog: { logActionByUserId: jest.fn() },
      realtimeGateway: { broadcastStatusChanged: jest.fn() },
      quoteOptionsService: {
        buildOptionLookupMaps: jest
          .fn()
          .mockResolvedValue({ stonePriceMap: new Map() }),
      },
    });
    return { svc, prisma };
  }

  it('đơn mới mang assignedOrderId của Order được chọn và trả kèm assignedOrder trong response', async () => {
    const tx = makeTx({ orders: ['a', 'b'], todayCounts: { a: 3, b: 1 } });
    tx.quoteRequest.create.mockResolvedValue({
      id: 'q1',
      status: 'PENDING',
      assignedOrderId: 'b',
      assignedOrder: { id: 'b', name: 'Order B', email: 'b@x.vn' },
      images: [],
      options: [],
    });
    const { svc } = setup([tx]);

    const out = await svc.create('sale1', 'SALE' as any, dto);

    const arg = tx.quoteRequest.create.mock.calls[0][0];
    expect(arg.data.assignedOrderId).toBe('b');
    expect(arg.include).toBe(REQUEST_DETAIL_INCLUDE);
    expect(out.assignedOrder).toEqual({
      id: 'b',
      name: 'Order B',
      email: 'b@x.vn',
    });
  });

  it('không có Order nào → vẫn tạo đơn, assignedOrderId = null', async () => {
    const tx = makeTx({ orders: [] });
    tx.quoteRequest.create.mockResolvedValue({
      id: 'q1',
      status: 'PENDING',
      assignedOrderId: null,
      images: [],
      options: [],
    });
    const { svc } = setup([tx]);

    await svc.create('sale1', 'SALE' as any, dto);

    expect(
      tx.quoteRequest.create.mock.calls[0][0].data.assignedOrderId,
    ).toBeNull();
  });

  it('trùng mã yêu cầu (P2002) → chạy lại CẢ transaction: chọn người lại và insert với mã mới', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
      meta: { target: ['code'] },
    });
    const tx1 = makeTx({ orders: ['a'] });
    tx1.quoteRequest.create.mockRejectedValue(dup);
    const tx2 = makeTx({ orders: ['a'] });
    tx2.quoteRequest.create.mockResolvedValue({
      id: 'q1',
      status: 'PENDING',
      assignedOrderId: 'a',
      images: [],
      options: [],
    });
    const { svc, prisma } = setup([tx1, tx2]);

    await svc.create('sale1', 'SALE' as any, dto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx2.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx2.quoteRequest.create.mock.calls[0][0].data.assignedOrderId).toBe(
      'a',
    );
  });
});

describe('QuoteQueryService.findAll — cột "Người được giao"', () => {
  const user = { id: 'admin1', role: 'ADMIN' } as any;

  function setup(items: any[]) {
    const prisma = {
      quoteRequest: {
        findMany: jest.fn().mockResolvedValue(items),
        count: jest.fn().mockResolvedValue(items.length),
      },
    };
    return { svc: new QuoteQueryService(prisma as any), prisma };
  }

  it('danh sách đầy đủ select assignedOrderId + assignedOrder và trả về cho FE', async () => {
    const item = {
      id: 'q1',
      assignedOrderId: 'o1',
      assignedOrder: { id: 'o1', name: 'Order 1', email: 'o1@x.vn' },
      options: [],
      images: [],
    };
    const { svc, prisma } = setup([item]);

    const res = await svc.findAll({} as any, user);

    const select = prisma.quoteRequest.findMany.mock.calls[0][0].select;
    expect(select.assignedOrderId).toBe(true);
    expect(select.assignedOrder).toEqual({
      select: { id: true, name: true, email: true },
    });
    expect(res.data[0].assignedOrder).toEqual({
      id: 'o1',
      name: 'Order 1',
      email: 'o1@x.vn',
    });
  });

  it('chế độ lite (dashboard) không kéo quan hệ assignedOrder cho nhẹ query', async () => {
    const { svc, prisma } = setup([]);
    await svc.findAll({ lite: 'true' } as any, user);
    const select = prisma.quoteRequest.findMany.mock.calls[0][0].select;
    expect(select.assignedOrder).toBeUndefined();
  });
});

describe('buildQuoteWhereClause — lọc theo người được giao', () => {
  const admin = { id: 'admin1', role: 'ADMIN' } as any;

  it('có assignedOrderId → thêm điều kiện lọc đúng cột assignedOrderId (không lẫn với assigneeId)', () => {
    const where: any = buildQuoteWhereClause(
      { assignedOrderId: 'o1' } as any,
      admin,
    );
    expect(where.AND).toContainEqual({ assignedOrderId: 'o1' });
    expect(where.AND).not.toContainEqual({ assigneeId: 'o1' });
  });

  it('không truyền assignedOrderId → không có điều kiện đó', () => {
    const where: any = buildQuoteWhereClause({} as any, admin);
    const hasIt = (where.AND ?? []).some((c: any) => 'assignedOrderId' in c);
    expect(hasIt).toBe(false);
  });
});

describe('Export Excel — cột "Người được giao"', () => {
  const def = EXPORT_FIELD_DEFS.find((f) => f.key === 'assignedOrder');

  it('có khai báo cột assignedOrder với tiêu đề tiếng Việt', () => {
    expect(def?.header).toBe('Người được giao');
  });

  it('lấy tên Order được giao; đơn cũ chưa có thì "Chưa có"', () => {
    expect(def?.value({ assignedOrder: { name: 'Order A' } })).toBe('Order A');
    expect(def?.value({ assignedOrder: null })).toBe('Chưa có');
  });

  it('findAllForExport select assignedOrder để cột có dữ liệu', async () => {
    const prisma = {
      quoteRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new QuoteQueryService(prisma as any);
    await svc.findAllForExport({} as any, { id: 'a', role: 'ADMIN' } as any);
    const select = prisma.quoteRequest.findMany.mock.calls[0][0].select;
    expect(select.assignedOrder).toEqual({
      select: { id: true, name: true, email: true },
    });
  });
});
