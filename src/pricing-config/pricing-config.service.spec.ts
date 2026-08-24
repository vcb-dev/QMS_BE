import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PricingConfigService } from './pricing-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPricesService } from '../metal-prices/metal-prices.service';
import { MaterialsService } from '../materials/materials.service';
import { PricingFormulasService } from '../pricing-formulas/pricing-formulas.service';

describe('PricingConfigService.calculateMulti', () => {
  let service: PricingConfigService;
  let prisma: {
    stone: { findMany: jest.Mock };
    pricingFormula: { findUniqueOrThrow: jest.Mock };
  };
  let metalPricesService: { getLatestAsync: jest.Mock };
  let materialsService: { findAll: jest.Mock };
  let pricingFormulasService: { getDefault: jest.Mock };

  // 1 công thức bậc lợi nhuận duy nhất — Vàng 10K/14K dùng chung (giữ đúng kết quả tính đã
  // verify trước đây: đơn tier, divisor 0.8, margin 20%)
  const MARGIN_FORMULA = {
    id: 'pfm-margin',
    name: 'Bậc lợi nhuận theo chi phí',
    formulaType: 'MARGIN_TIERS',
    config: { tiers: [{ maxCost: 999999999999, divisor: 0.8, margin: '20%' }] },
    isDefault: true,
  };

  const MULTIPLIER_FORMULA = {
    id: 'pfm-silver',
    name: 'Hệ số nhân Bạc',
    formulaType: 'MULTIPLIER',
    config: { multipliers: [3] },
    isDefault: false,
  };

  // priceRatioPct dạng phân số (<=1) đi thẳng qua normalizeAppliedRatio không đổi — tương đương
  // 10K=42%, 14K=58.5% như goldRatios cũ, giữ nguyên kết quả tính đã verify ở các test dưới.
  const MATERIALS = [
    {
      id: 'm1',
      name: 'Vàng 10K',
      priceRatioPct: 0.42,
      pricingFormula: MARGIN_FORMULA,
    },
    {
      id: 'm2',
      name: 'Vàng 14K',
      priceRatioPct: 0.585,
      pricingFormula: MARGIN_FORMULA,
    },
    {
      id: 'm3',
      name: 'Bạc 925',
      priceRatioPct: 1,
      pricingFormula: MULTIPLIER_FORMULA,
    },
  ];

  beforeEach(async () => {
    prisma = {
      stone: { findMany: jest.fn() },
      pricingFormula: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(MARGIN_FORMULA),
      },
    };
    metalPricesService = {
      getLatestAsync: jest.fn().mockResolvedValue({
        gold24kVnd: 10_000_000,
        silverVnd: 1_000_000,
        platinumVnd: 0,
      }),
    };
    materialsService = {
      findAll: jest.fn().mockResolvedValue(MATERIALS),
    };
    pricingFormulasService = {
      getDefault: jest.fn().mockResolvedValue(MARGIN_FORMULA),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetalPricesService, useValue: metalPricesService },
        { provide: MaterialsService, useValue: materialsService },
        { provide: PricingFormulasService, useValue: pricingFormulasService },
      ],
    }).compile();

    service = module.get<PricingConfigService>(PricingConfigService);
  });

  it('sums metal cost across multiple gold materials', async () => {
    const result = await service.calculateMulti({
      materials: [
        { materialId: 'm1', materialName: 'Vàng 10K', weightChi: 2 },
        { materialId: 'm2', materialName: 'Vàng 14K', weightChi: 1 },
      ],
      laborCost: 500000,
      vatRate: 10,
      includeVat: true,
    } as any);

    // totalMetalCost là giá bán cuối (kim loại+công, đã qua VAT 10% + margin chia 0.8):
    // (8.400.000 + 5.850.000 + 500.000 tiền công) × 1.10 ÷ 0.8 = 20.281.250
    expect(result.totalMetalCost).toBe(20_281_250);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0]).toMatchObject({
      materialId: 'm1',
      cost: 8_400_000,
    });
    expect(result.breakdown[1]).toMatchObject({
      materialId: 'm2',
      cost: 5_850_000,
    });
  });

  it('sums stone cost from DB-picked stones with quantity', async () => {
    prisma.stone.findMany.mockResolvedValue([
      { id: 's1', price: 200000 },
      { id: 's2', price: 50000 },
    ]);

    const result = await service.calculateMulti({
      materials: [{ materialId: 'm1', materialName: 'Vàng 10K', weightChi: 1 }],
      laborCost: 0,
      stones: [
        { stoneId: 's1', quantity: 1 },
        { stoneId: 's2', quantity: 4 },
      ],
    } as any);

    expect(result.stoneCost).toBe(400_000);
  });

  it('uses manual stone price when manualStoneName is provided', async () => {
    const result = await service.calculateMulti({
      materials: [{ materialId: 'm1', materialName: 'Vàng 10K', weightChi: 1 }],
      manualStoneName: 'Kim cương lạ',
      manualStonePrice: 777000,
    } as any);

    expect(result.stoneCost).toBe(777_000);
  });

  it('rejects empty materials array', async () => {
    await expect(
      service.calculateMulti({ materials: [] } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a material row with weightChi <= 0', async () => {
    await expect(
      service.calculateMulti({
        materials: [
          { materialId: 'm1', materialName: 'Vàng 10K', weightChi: 0 },
        ],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when both manual and catalog stone input are provided', async () => {
    await expect(
      service.calculateMulti({
        materials: [
          { materialId: 'm1', materialName: 'Vàng 10K', weightChi: 1 },
        ],
        manualStoneName: 'Đá lạ',
        manualStonePrice: 100000,
        stones: [{ stoneId: 's1', quantity: 1 }],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a silver material mixed into a multi-material calculation', async () => {
    await expect(
      service.calculateMulti({
        materials: [
          { materialId: 'm1', materialName: 'Bạc 925', weightChi: 1 },
        ],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
