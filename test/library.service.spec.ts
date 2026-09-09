import { Role } from '@prisma/client';
import { LibraryService } from '../src/quote-requests/library/library.service';

describe('LibraryService', () => {
  let svc: any;
  let prisma: any;
  let quoteOptionsService: any;
  let queryService: any;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{
        gkey: 'group1',
        rep_id: 'opt1',
        total: 1n,
        dup_count: 1n,
        q_min: 1000,
        q_max: 2000,
        mat_min: 500,
        mat_max: 800,
        stone_min: 200,
        stone_max: 300,
      }]),
      quoteOption: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'opt1',
          quoteRequest: { id: 'req1', category: { name: 'Cat' }, requester: { name: 'Req' }, images: [] },
          laborCost: 100,
          stoneCost: 200,
          totalMetalCost: 300,
          metalRawCost: 400,
          stonePrice: 500,
          costBreakdown: {}
        }])
      }
    };
    quoteOptionsService = {
      batchComputeLivePrices: jest.fn().mockResolvedValue(new Map())
    };
    queryService = {
      stripCostFieldsForSale: jest.fn((opts) => {
        return opts.map((opt: any) => {
          const { laborCost, stoneCost, totalMetalCost, metalRawCost, stonePrice, costBreakdown, ...rest } = opt;
          return rest;
        });
      })
    };

    svc = new LibraryService(prisma, quoteOptionsService, queryService);
  });

  it('getLibraryProducts(dto, Role.SALE) -> option không có cost fields', async () => {
    const res = await svc.getLibraryProducts({}, Role.SALE);
    expect(res.data[0].option).not.toHaveProperty('laborCost');
    expect(res.data[0].option).not.toHaveProperty('stoneCost');
    expect(res.data[0].option).not.toHaveProperty('totalMetalCost');
    expect(queryService.stripCostFieldsForSale).toHaveBeenCalled();
  });

  it('getLibraryProducts(dto, Role.ORDER) -> option vẫn còn cost fields', async () => {
    const res = await svc.getLibraryProducts({}, Role.ORDER);
    expect(res.data[0].option).toHaveProperty('laborCost');
    expect(res.data[0].option).toHaveProperty('stoneCost');
    expect(queryService.stripCostFieldsForSale).not.toHaveBeenCalled();
  });

  it('price aggregations match for SALE and ORDER', async () => {
    const resSale = await svc.getLibraryProducts({}, Role.SALE);
    const resOrder = await svc.getLibraryProducts({}, Role.ORDER);

    const checkKeys = ['priceMin', 'priceMax', 'livePriceMin', 'livePriceMax', 'priceMaterialMin', 'priceMaterialMax', 'priceStoneMin', 'priceStoneMax'];
    for (const key of checkKeys) {
      expect(resSale.data[0][key]).toEqual(resOrder.data[0][key]);
    }
  });
});
