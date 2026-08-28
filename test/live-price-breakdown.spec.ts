import { Test, TestingModule } from '@nestjs/testing';
import { QuoteOptionsService } from '../src/quote-requests/quote-option/quote-options.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MetalPricesService } from '../src/metal-prices/metal-prices.service';
import { MaterialsService } from '../src/materials/materials.service';
import { PricingFormulasService } from '../src/pricing-formulas/pricing-formulas.service';
import { StonesService } from '../src/stones/stones.service';

describe('batchComputeLivePrices trả 3 số { total, material, stone }', () => {
  let svc: QuoteOptionsService;

  const TIERS = [{ maxCost: 999_999_999_999, divisor: 0.9, margin: '10%' }];
  const GOLD_FORMULA = {
    id: 'f-gold',
    name: 'Bậc Vàng',
    formulaType: 'MARGIN_TIERS',
    config: { tiers: TIERS },
  };
  const MATERIALS = [
    {
      id: 'm1',
      name: 'Vàng 24K',
      priceRatioPct: 100,
      baseMetalId: 'bm-gold',
      baseMetal: { id: 'bm-gold', name: 'Vàng 24K', isDefault: true },
      pricingFormula: GOLD_FORMULA,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteOptionsService,
        { provide: PrismaService, useValue: {} },
        {
          provide: MetalPricesService,
          useValue: {
            getLatestAsync: jest
              .fn()
              .mockResolvedValue(new Map([['bm-gold', 7_000_000]])),
          },
        },
        {
          provide: MaterialsService,
          useValue: { findAll: jest.fn().mockResolvedValue(MATERIALS) },
        },
        {
          provide: PricingFormulasService,
          useValue: {
            getDefault: jest
              .fn()
              .mockResolvedValue({ config: { tiers: TIERS } }),
          },
        },
        {
          provide: StonesService,
          useValue: {
            findAll: jest
              .fn()
              .mockResolvedValue([{ id: 's1', price: 2_000_000 }]),
          },
        },
      ],
    }).compile();

    svc = module.get<QuoteOptionsService>(QuoteOptionsService);
  });

  it('material + stone == total; stone > 0 khi có đá', async () => {
    const map = await svc.batchComputeLivePrices([
      {
        key: 'k1',
        materials: [{ materialId: 'm1', weightChi: 2 }],
        laborCost: 500_000,
        vatRate: 10,
        stones: [{ stoneId: 's1', quantity: 1 }],
      },
    ]);
    const e = map.get('k1');
    expect(e).not.toBeNull();
    expect(e!.material + e!.stone).toBe(e!.total);
    expect(e!.stone).toBeGreaterThan(0);
  });

  it('option lỗi trả null riêng, không làm hỏng batch', async () => {
    const map = await svc.batchComputeLivePrices([
      {
        key: 'ok',
        materials: [{ materialId: 'm1', weightChi: 1 }],
        laborCost: 0,
        vatRate: 10,
      },
      {
        key: 'bad',
        materials: [{ materialId: 'NONE', weightChi: 1 }],
        laborCost: 0,
        vatRate: 10,
      },
    ]);
    expect(map.get('bad')).toBeNull();
    const ok = map.get('ok');
    expect(ok).not.toBeNull();
    expect(ok!.material + ok!.stone).toBe(ok!.total);
    expect(ok!.stone).toBe(0);
  });
});
