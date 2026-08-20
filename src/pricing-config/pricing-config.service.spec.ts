import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PricingConfigService } from './pricing-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPricesService } from '../metal-prices/metal-prices.service';

describe('PricingConfigService.calculateMulti', () => {
  let service: PricingConfigService;
  let prisma: {
    pricingConfig: { findUnique: jest.Mock };
    stone: { findMany: jest.Mock };
  };
  let metalPricesService: { getLatestAsync: jest.Mock };

  const CONFIG_RECORD = {
    id: 'singleton',
    goldRatios: [
      { key: 'GOLD_10K', standard: 41.7, applied: 0.42, label: '10K' },
      { key: 'GOLD_14K', standard: 58.5, applied: 0.585, label: '14K' },
    ],
    profitMargins: [{ maxCost: 999999999999, divisor: 0.8, margin: '20%' }],
    silverMultipliers: [3],
    defaultVatRate: 10,
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      pricingConfig: { findUnique: jest.fn().mockResolvedValue(CONFIG_RECORD) },
      stone: { findMany: jest.fn() },
    };
    metalPricesService = {
      getLatestAsync: jest.fn().mockResolvedValue({
        gold24kVnd: 10_000_000,
        silverVnd: 1_000_000,
        platinumVnd: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetalPricesService, useValue: metalPricesService },
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
