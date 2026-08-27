import { Test, TestingModule } from '@nestjs/testing';
import { MetalPricesService } from '../src/metal-prices/metal-prices.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('MetalPricesService', () => {
  let service: MetalPricesService;
  let prisma: {
    baseMetal: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    baseMetalPriceHistory: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      baseMetal: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      baseMetalPriceHistory: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      // updatePrice dùng interactive transaction: $transaction(async (tx) => ...) — tx chính là
      // prisma mock này. Vẫn hỗ trợ dạng mảng cho chỗ khác nếu có.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(prisma)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetalPricesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MetalPricesService>(MetalPricesService);
  });

  describe('updatePrice', () => {
    it('tính đúng changePct so với dòng active TRƯỚC ĐÓ của CHÍNH kim loại này', async () => {
      prisma.baseMetalPriceHistory.findFirst.mockResolvedValueOnce({
        priceVnd: 10_000_000,
      });
      prisma.baseMetalPriceHistory.create.mockResolvedValueOnce({
        id: 'h2',
        baseMetalId: 'gold-1',
        priceVnd: 11_000_000,
        changePct: 10,
        isActive: true,
        updatedById: 'u1',
        updatedBy: { name: 'Admin' },
        createdAt: new Date(),
        source: 'cập nhật thủ công',
        baseMetal: { name: 'Vàng 24K' },
      });

      await service.updatePrice('gold-1', 11_000_000, { id: 'u1' });

      expect(prisma.baseMetalPriceHistory.updateMany).toHaveBeenCalledWith({
        where: { baseMetalId: 'gold-1', isActive: true },
        data: { isActive: false },
      });
      const createArg = prisma.baseMetalPriceHistory.create.mock.calls[0][0];
      expect(createArg.data.changePct).toBe(10);
    });

    it('changePct null nếu là lần đầu có giá của kim loại này', async () => {
      prisma.baseMetalPriceHistory.findFirst.mockResolvedValueOnce(null);
      prisma.baseMetalPriceHistory.create.mockResolvedValueOnce({
        id: 'h1',
        baseMetalId: 'titan-1',
        priceVnd: 500_000,
        changePct: null,
        isActive: true,
        updatedById: null,
        updatedBy: null,
        createdAt: new Date(),
        source: 'cập nhật thủ công',
        baseMetal: { name: 'Titanium' },
      });

      await service.updatePrice('titan-1', 500_000);

      const createArg = prisma.baseMetalPriceHistory.create.mock.calls[0][0];
      expect(createArg.data.changePct).toBeNull();
    });
  });
});
