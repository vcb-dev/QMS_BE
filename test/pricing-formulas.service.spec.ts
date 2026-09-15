import { Test, TestingModule } from '@nestjs/testing';
import { PricingFormulasService } from '../src/pricing-formulas/pricing-formulas.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingFormulaType } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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
            material: {
              count: jest.fn().mockResolvedValue(0),
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

  describe('remove', () => {
    it('throws NotFoundException khi không tìm thấy công thức', async () => {
      (prisma.pricingFormula.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.remove('id1')).rejects.toThrow(NotFoundException);
    });

    it('chặn xóa công thức đang đặt mặc định', async () => {
      (prisma.pricingFormula.findUnique as jest.Mock).mockResolvedValue({
        id: 'id1',
        isDefault: true,
      });
      await expect(service.remove('id1')).rejects.toThrow(BadRequestException);
      expect(prisma.pricingFormula.update).not.toHaveBeenCalled();
    });

    it('chặn xóa công thức còn chất liệu active đang dùng', async () => {
      (prisma.pricingFormula.findUnique as jest.Mock).mockResolvedValue({
        id: 'id1',
        isDefault: false,
      });
      (prisma.material.count as jest.Mock).mockResolvedValue(2);
      await expect(service.remove('id1')).rejects.toThrow(BadRequestException);
      expect(prisma.pricingFormula.update).not.toHaveBeenCalled();
    });

    it('xóa mềm (isActive=false) khi không phải mặc định và không còn chất liệu dùng', async () => {
      (prisma.pricingFormula.findUnique as jest.Mock).mockResolvedValue({
        id: 'id1',
        isDefault: false,
      });
      (prisma.material.count as jest.Mock).mockResolvedValue(0);
      const result = await service.remove('id1');
      expect(prisma.pricingFormula.update).toHaveBeenCalledWith({
        where: { id: 'id1' },
        data: { isActive: false },
      });
      expect(result).toEqual({ message: 'Đã xóa công thức thành công' });
    });
  });
});
