import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { QuoteOptionsService } from '../src/quote-requests/quote-option/quote-options.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MetalPricesService } from '../src/metal-prices/metal-prices.service';
import { MaterialsService } from '../src/materials/materials.service';
import { PricingFormulasService } from '../src/pricing-formulas/pricing-formulas.service';
import { StonesService } from '../src/stones/stones.service';

describe('QuoteOptionsService', () => {
  let service: QuoteOptionsService;
  const GOLD_FORMULA = {
    id: 'f-gold',
    name: 'Bậc Vàng',
    formulaType: 'MARGIN_TIERS',
    config: { tiers: [{ maxCost: 999_999_999, divisor: 0.9, margin: '10%' }] },
  };
  const MATERIALS = [
    {
      id: 'm-18k',
      name: 'Vàng 18K',
      priceRatioPct: 75,
      baseMetalId: 'gold-1',
      baseMetal: { id: 'gold-1', name: 'Vàng 24K', isDefault: true },
      pricingFormula: GOLD_FORMULA,
    },
    {
      id: 'm-24k',
      name: 'Vàng 24K',
      priceRatioPct: 100,
      baseMetalId: 'gold-1',
      baseMetal: { id: 'gold-1', name: 'Vàng 24K', isDefault: true },
      pricingFormula: GOLD_FORMULA,
    },
  ];

  let metalPricesService: { getLatestAsync: jest.Mock };
  let materialsService: { findAll: jest.Mock };
  let pricingFormulasService: { getDefault: jest.Mock };

  beforeEach(async () => {
    metalPricesService = {
      getLatestAsync: jest
        .fn()
        .mockResolvedValue(new Map([['gold-1', 10_000_000]])),
    };
    materialsService = { findAll: jest.fn().mockResolvedValue(MATERIALS) };
    pricingFormulasService = {
      getDefault: jest.fn().mockResolvedValue({ config: { tiers: [] } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteOptionsService,
        { provide: PrismaService, useValue: {} },
        { provide: MetalPricesService, useValue: metalPricesService },
        { provide: MaterialsService, useValue: materialsService },
        { provide: PricingFormulasService, useValue: pricingFormulasService },
        {
          provide: StonesService,
          useValue: { findAll: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    service = module.get<QuoteOptionsService>(QuoteOptionsService);
  });

  describe('calculate5StepPrice — resolve theo tên khớp CHÍNH XÁC (không đoán qua regex)', () => {
    it('khớp đúng "Vàng 18K", không nhầm sang "Vàng 24K" dù cùng baseMetal', async () => {
      const result = await service.calculate5StepPrice({
        materialNameOrKey: 'Vàng 18K',
        weightChi: 1,
        laborCost: 0,
        stoneCost: 0,
        vatRate: 0,
      });
      // 10.000.000 * 0.75 = 7.500.000 giá vốn kim loại
      expect(result.metalPricePerChi).toBe(7_500_000);
      // Bất biến tách giá: materialPrice + stonePrice == quotedPrice
      expect(result.materialPrice + result.stonePrice).toBe(result.quotedPrice);
    });

    it('materialPrice + stonePrice == quotedPrice khi có tiền đá', async () => {
      const result = await service.calculate5StepPrice({
        materialNameOrKey: 'Vàng 18K',
        weightChi: 2,
        laborCost: 500_000,
        stoneCost: 1_200_000,
        vatRate: 10,
      });
      expect(result.materialPrice + result.stonePrice).toBe(result.quotedPrice);
    });

    it('calculateBatch: mỗi phương án hợp lệ giữ bất biến materialPrice + stonePrice == quotedPrice', async () => {
      const results = await service.calculateBatch({
        items: [
          { materialNameOrKey: 'Vàng 18K', weightChi: 1, stoneCost: 800_000 },
          { materialNameOrKey: 'Vàng 24K', weightChi: 1, stoneCost: 0 },
        ],
      });
      for (const r of results) {
        expect(r.error).toBeUndefined();
        expect(r.materialPrice! + r.stonePrice!).toBe(r.quotedPrice);
      }
    });

    it('ném BadRequestException khi tên không khớp material nào', async () => {
      await expect(
        service.calculate5StepPrice({
          materialNameOrKey: 'Chất liệu không tồn tại',
          weightChi: 1,
          laborCost: 0,
          stoneCost: 0,
          vatRate: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
