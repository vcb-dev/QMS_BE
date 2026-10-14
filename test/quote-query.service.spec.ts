import { QuoteQueryService } from '../src/quote-requests/quote/quote-query.service';

describe('QuoteQueryService — priceBreakdown tách giá chất liệu / giá đá', () => {
  it('stripCostFieldsForSale giữ priceBreakdown, bỏ giá vốn', () => {
    const svc = new QuoteQueryService({} as any);
    const out = (svc.stripCostFieldsForSale([
      {
        quotedPrice: 10_000_000,
        stonePrice: 3_000_000,
        totalMetalCost: 7_000_000,
        metalRawCost: 5_000_000,
        laborCost: 500_000,
        stoneCost: 2_000_000,
        priceBreakdown: { material: 7_000_000, stone: 3_000_000 },
      },
    ]) ?? [])[0];
    expect(out.priceBreakdown).toEqual({
      material: 7_000_000,
      stone: 3_000_000,
    });
    expect(out.stonePrice).toBeUndefined();
    expect(out.totalMetalCost).toBeUndefined();
    expect(out.metalRawCost).toBeUndefined();
    expect(out.laborCost).toBeUndefined();
    expect(out.stoneCost).toBeUndefined();
  });
});

describe('QuoteQueryService.findAll — hiển thị team của Sale tạo đơn', () => {
  it('chọn thêm requester.team { id, name } để FE hiện team dưới tên Sale', async () => {
    const prisma: any = {
      quoteRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const svc = new QuoteQueryService(prisma);

    await svc.findAll({} as any, { id: 'u1', role: 'ADMIN' } as any);

    const { select } = prisma.quoteRequest.findMany.mock.calls[0][0];
    expect(select.requester).toEqual({
      select: {
        id: true,
        name: true,
        email: true,
        team: { select: { id: true, name: true } },
      },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Đơn đã hủy (CANCELLED): chỉ ADMIN thấy — danh sách, đếm theo tab, export, chi tiết
// ---------------------------------------------------------------------------------------------
import { NotFoundException } from '@nestjs/common';

describe('QuoteQueryService — đơn đã hủy chỉ ADMIN thấy', () => {
  const notCancelled = JSON.stringify({ not: 'CANCELLED' });
  // Tìm {status:{not:'CANCELLED'}} ở mọi độ sâu của cây where.
  const hasNot = (node: any): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(hasNot);
    if (JSON.stringify(node.status) === notCancelled) return true;
    return Object.values(node).some(hasNot);
  };
  const user = (role: string) => ({ id: `u-${role}`, role }) as any;

  const makePrisma = (groupByRows: any[] = []) => ({
    quoteRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue(groupByRows),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  });
  const totalCountWhere = (prisma: any) =>
    prisma.quoteRequest.count.mock.calls
      .map((c: any[]) => c[0].where)
      .find((w: any) => w.AND !== undefined);
  const myReqCountWhere = (prisma: any) =>
    prisma.quoteRequest.count.mock.calls
      .map((c: any[]) => c[0].where)
      .find((w: any) => w.AND === undefined);

  it.each(['SALE', 'ORDER'])(
    'findAll (%s): danh sách, tổng, đếm theo tab và "của tôi" đều loại đơn hủy',
    async (role) => {
      const prisma = makePrisma();
      const svc = new QuoteQueryService(prisma as any);

      await svc.findAll({ includeCounts: 'true' } as any, user(role));

      expect(hasNot(prisma.quoteRequest.findMany.mock.calls[0][0].where)).toBe(true);
      expect(hasNot(totalCountWhere(prisma))).toBe(true);
      expect(hasNot(prisma.quoteRequest.groupBy.mock.calls[0][0].where)).toBe(true);
      expect(hasNot(myReqCountWhere(prisma))).toBe(true);
    },
  );

  it.each(['SALE', 'ORDER'])(
    'findAll (%s) với status=CANCELLED: vẫn bị loại (kết quả rỗng, không lộ)',
    async (role) => {
      const prisma = makePrisma();
      const svc = new QuoteQueryService(prisma as any);

      await svc.findAll({ status: 'CANCELLED' } as any, user(role));

      const { where } = prisma.quoteRequest.findMany.mock.calls[0][0];
      expect(where.AND).toContainEqual({ status: 'CANCELLED' });
      expect(hasNot(where)).toBe(true);
    },
  );

  it('findAll (ADMIN) mặc định: danh sách loại đơn hủy, nhưng groupBy đếm theo tab KHÔNG loại để có số tab "Đã hủy"', async () => {
    const prisma = makePrisma([
      { status: 'CANCELLED', _count: { _all: 2 } },
      { status: 'QUOTED', _count: { _all: 5 } },
    ]);
    const svc = new QuoteQueryService(prisma as any);

    const res: any = await svc.findAll({ includeCounts: 'true' } as any, user('ADMIN'));

    expect(hasNot(prisma.quoteRequest.findMany.mock.calls[0][0].where)).toBe(true);
    expect(hasNot(totalCountWhere(prisma))).toBe(true);
    expect(hasNot(prisma.quoteRequest.groupBy.mock.calls[0][0].where)).toBe(false);
    expect(hasNot(myReqCountWhere(prisma))).toBe(true); // "của tôi" cũng không tính đơn hủy
    expect(res.meta.counts.cancelled).toBe(2);
    expect(res.meta.counts.total).toBe(5); // đơn hủy không cộng vào tổng
  });

  it('findAll (ADMIN) status=CANCELLED: lấy đúng đơn hủy, không có điều kiện loại', async () => {
    const prisma = makePrisma();
    const svc = new QuoteQueryService(prisma as any);

    await svc.findAll({ status: 'CANCELLED' } as any, user('ADMIN'));

    const { where } = prisma.quoteRequest.findMany.mock.calls[0][0];
    expect(where.AND).toContainEqual({ status: 'CANCELLED' });
    expect(hasNot(where)).toBe(false);
    expect(hasNot(totalCountWhere(prisma))).toBe(false);
  });

  it('findAllForExport: ORDER bị loại đơn hủy; ADMIN chọn status=CANCELLED xuất được đơn hủy', async () => {
    const prismaOrder = makePrisma();
    await new QuoteQueryService(prismaOrder as any).findAllForExport({} as any, user('ORDER'));
    expect(hasNot(prismaOrder.quoteRequest.findMany.mock.calls[0][0].where)).toBe(true);

    const prismaAdminAll = makePrisma();
    await new QuoteQueryService(prismaAdminAll as any).findAllForExport({} as any, user('ADMIN'));
    expect(hasNot(prismaAdminAll.quoteRequest.findMany.mock.calls[0][0].where)).toBe(true);

    const prismaAdminCancelled = makePrisma();
    await new QuoteQueryService(prismaAdminCancelled as any).findAllForExport(
      { status: 'CANCELLED' } as any,
      user('ADMIN'),
    );
    const { where } = prismaAdminCancelled.quoteRequest.findMany.mock.calls[0][0];
    expect(where.AND).toContainEqual({ status: 'CANCELLED' });
    expect(hasNot(where)).toBe(false);
  });

  it.each([['SALE'], ['ORDER'], [undefined]])(
    'findOne (role=%s): tra cả theo id lẫn theo mã, điều kiện loại đơn hủy luôn đi kèm → đơn hủy là 404',
    async (role) => {
      const prisma = makePrisma();
      const svc = new QuoteQueryService(prisma as any);

      await expect(svc.findOne('QG-2026-1234', role as any)).rejects.toThrow(
        NotFoundException,
      );

      const { where } = prisma.quoteRequest.findFirst.mock.calls[0][0];
      expect(where.AND[0]).toEqual({
        OR: [{ id: 'QG-2026-1234' }, { code: 'QG-2026-1234' }],
      });
      expect(hasNot(where.AND[1])).toBe(true);
    },
  );

  it('findOne (ADMIN): không có điều kiện loại → thấy được đơn hủy', async () => {
    const prisma = makePrisma();
    const svc = new QuoteQueryService(prisma as any);

    await expect(svc.findOne('q1', 'ADMIN' as any)).rejects.toThrow(NotFoundException);

    expect(hasNot(prisma.quoteRequest.findFirst.mock.calls[0][0].where)).toBe(false);
  });
});
