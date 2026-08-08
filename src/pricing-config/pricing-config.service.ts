import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPricesService } from '../metal-prices/metal-prices.service';
import {
  PricingConfigDto,
  CalculatePriceInput,
  PricingCalculationResult,
} from './dto/pricing-config.dto';

@Injectable()
export class PricingConfigService {
  private readonly logger = new Logger(PricingConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metalPricesService: MetalPricesService,
  ) {}

  async getConfig(): Promise<PricingConfigDto> {
    const record = await this.prisma.pricingConfig.findUnique({
      where: { id: 'singleton' },
    });

    if (!record) {
      this.logger.warn('Chưa có cấu hình PricingConfig trong DB');
      throw new NotFoundException('Chưa tìm thấy bản ghi cấu hình trong Database.');
    }

    return {
      goldRatios: record.goldRatios as any,
      profitMargins: record.profitMargins as any,
      silverMultiplier: Number(record.silverMultiplier),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async updateConfig(dto: Partial<PricingConfigDto>): Promise<PricingConfigDto> {
    const updated = await this.prisma.pricingConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        goldRatios: (dto.goldRatios || []) as any,
        profitMargins: (dto.profitMargins || []) as any,
        silverMultiplier: dto.silverMultiplier ?? 3,
      },
      update: {
        ...(dto.goldRatios ? { goldRatios: dto.goldRatios as any } : {}),
        ...(dto.profitMargins ? { profitMargins: dto.profitMargins as any } : {}),
        ...(dto.silverMultiplier !== undefined ? { silverMultiplier: dto.silverMultiplier } : {}),
      },
    });

    this.logger.log('Đã cập nhật cấu hình PricingConfig trực tiếp vào Database PostgreSQL');
    return {
      goldRatios: updated.goldRatios as any,
      profitMargins: updated.profitMargins as any,
      silverMultiplier: Number(updated.silverMultiplier),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Động cơ tính giá lõi 5 bước trang sức phụ thuộc 100% vào Database (Không hardcode tỉ lệ/hệ số)
   */
  async calculate5StepPrice(input: CalculatePriceInput): Promise<PricingCalculationResult> {
    const config = await this.getConfig();
    const metalPrices = await this.metalPricesService.getLatestAsync();

    const { materialNameOrKey, weightChi = 0, laborCost = 0, stoneCost = 0, vatRate = 0 } = input;

    const normalizedMat = (materialNameOrKey || '').trim().toUpperCase();
    let metalPricePerChi = 0;

    // Bước 1: Tính giá kim loại theo quy tắc Vàng / Bạc
    if (normalizedMat.includes('BẠC') || normalizedMat.includes('SILVER') || normalizedMat.includes('925')) {
      metalPricePerChi = metalPrices.silverVnd * config.silverMultiplier;
    } else {
      const matchedRatio = (config.goldRatios || []).find((r) => {
        const key = (r.key || '').toUpperCase();
        const label = (r.label || '').toUpperCase();
        const keyClean = key.replace('GOLD_', '');
        return (
          normalizedMat.includes(key) ||
          normalizedMat.includes(label) ||
          normalizedMat.includes(keyClean)
        );
      });

      if (!matchedRatio) {
        throw new BadRequestException(
          `Không tìm thấy cấu hình tỷ lệ áp dụng cho chất liệu "${materialNameOrKey}" trong Database.`,
        );
      }

      metalPricePerChi = metalPrices.gold24kVnd * matchedRatio.applied;
    }

    const totalMetalCost = weightChi * metalPricePerChi;

    // Bước 2: Tổng chi phí sản xuất (Cost Price)
    const totalProductionCost = totalMetalCost + laborCost + stoneCost;

    // Bước 3: Áp dụng Lợi nhuận (Profit Margin) động từ DB
    const sortedMargins = [...(config.profitMargins || [])].sort((a, b) => a.maxCost - b.maxCost);
    if (sortedMargins.length === 0) {
      throw new BadRequestException('Chưa cấu hình bảng lợi nhuận profitMargins trong Database.');
    }

    const matchedMargin = sortedMargins.find((m) => totalProductionCost <= m.maxCost) || sortedMargins[sortedMargins.length - 1];

    const divisor = matchedMargin.divisor;
    const marginLabel = matchedMargin.margin;

    const subtotalPrice = divisor > 0 ? totalProductionCost / divisor : totalProductionCost;

    // Bước 4: Thuế VAT
    const vatAmount = subtotalPrice * (vatRate / 100);

    // Bước 5: Tổng giá báo hoàn chỉnh
    const quotedPrice = Math.round(subtotalPrice + vatAmount);

    return {
      materialNameOrKey,
      metalPricePerChi: Math.round(metalPricePerChi),
      totalMetalCost: Math.round(totalMetalCost),
      laborCost,
      stoneCost,
      totalProductionCost: Math.round(totalProductionCost),
      profitMarginDivisor: divisor,
      profitMarginLabel: marginLabel,
      subtotalPrice: Math.round(subtotalPrice),
      vatRate,
      vatAmount: Math.round(vatAmount),
      quotedPrice,
    };
  }
}
