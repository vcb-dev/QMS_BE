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
