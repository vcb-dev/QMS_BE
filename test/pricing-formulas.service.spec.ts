import { Test, TestingModule } from '@nestjs/testing';
import { PricingFormulasService } from '../src/pricing-formulas/pricing-formulas.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingFormulaType } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('PricingFormulasService', () => {
  let service: PricingFormulasService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingFormulasService,
        {
          provide: PrismaService,
          useValue: {
            pricingFormula: {
              create: jest.fn(),
              update: jest.fn(),
              findUnique: jest.fn(),
              updateMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<PricingFormulasService>(PricingFormulasService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates successfully with valid MARGIN_TIERS config', async () => {
      const config = { tiers: [{ maxCost: 5000000, divisor: 0.85, margin: '15%' }] };
      await service.create({
        name: 'Test',
        formulaType: PricingFormulaType.MARGIN_TIERS,
        config,
      });
      expect(prisma.pricingFormula.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: expect.objectContaining(config),
          }),
        }),
      );
    });

    it('throws BadRequestException for MARGIN_TIERS with invalid divisor', async () => {
      const config = { tiers: [{ maxCost: 5000000, divisor: 0.001, margin: '15%' }] };
      await expect(
        service.create({
          name: 'Test',
          formulaType: PricingFormulaType.MARGIN_TIERS,
          config,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for MARGIN_TIERS with empty tiers', async () => {
      const config = { tiers: [] };
      await expect(
        service.create({
          name: 'Test',
          formulaType: PricingFormulaType.MARGIN_TIERS,
          config,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for MARGIN_TIERS with wrong config shape (multipliers)', async () => {
      const config = { multipliers: [3] };
      await expect(
        service.create({
          name: 'Test',
          formulaType: PricingFormulaType.MARGIN_TIERS,
          config,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates successfully with valid MULTIPLIER config', async () => {
      const config = { multipliers: [2, 3] };
      await service.create({
        name: 'Test',
        formulaType: PricingFormulaType.MULTIPLIER,
        config,
      });
      expect(prisma.pricingFormula.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: expect.objectContaining(config),
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('does not call findUnique if config is not provided', async () => {
      await service.update('id1', { name: 'X' });
      expect(prisma.pricingFormula.findUnique).not.toHaveBeenCalled();
      expect(prisma.pricingFormula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'X' }),
        }),
      );
    });
  });
});
