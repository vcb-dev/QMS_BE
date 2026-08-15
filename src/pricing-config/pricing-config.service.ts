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

    // Bạc: quy tắc riêng theo spec — giá bán = giá vốn (giá bạc/chỉ DB × trọng lượng) × silverMultiplier.
    // Không cộng tiền công/đá, không qua bảng margin, không VAT.
    if (normalizedMat.includes('BẠC') || normalizedMat.includes('SILVER') || normalizedMat.includes('925')) {
      const metalPricePerChi = metalPrices.silverVnd;
      const totalMetalCost = weightChi * metalPricePerChi;
      const quotedPrice = Math.round(totalMetalCost * config.silverMultiplier);

      return {
        materialNameOrKey,
        metalPricePerChi: Math.round(metalPricePerChi),
        totalMetalCost: Math.round(totalMetalCost),
        laborCost: 0,
        stoneCost: 0,
        totalProductionCost: Math.round(totalMetalCost),
        profitMarginDivisor: config.silverMultiplier,
        profitMarginLabel: `Bạc: giá vốn × ${config.silverMultiplier}`,
        subtotalPrice: quotedPrice,
        vatRate: 0,
        vatAmount: 0,
        quotedPrice,
      };
    }

    let metalPricePerChi = 0;

    // Bước 1: Tính giá vàng theo tuổi (luôn dùng giá đang lưu trong DB)
    {
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

      const goldRate = metalPrices.gold24kVnd;
      metalPricePerChi = goldRate * matchedRatio.applied;
    }

    const totalMetalCost = weightChi * metalPricePerChi;

    // Bước 2: Tổng chi phí sản xuất (Cost Price)
    const totalProductionCost = totalMetalCost + laborCost + stoneCost;

    // Bước 3: Áp dụng Lợi nhuận (Profit Margin) động từ DB
    const sortedMargins = [...(config.profitMargins || [])].sort((a, b) => a.maxCost - b.maxCost);
    if (sortedMargins.length === 0) {
      throw new BadRequestException('Chưa cấu hình bảng lợi nhuận profitMargins trong Database.');
    }

    // Bước 4: Thuế VAT — cộng VAT vào giá vốn TRƯỚC khi chọn bậc margin (đúng thứ tự theo spec)
    const costWithVat = totalProductionCost * (1 + vatRate / 100);

    const matchedMargin = sortedMargins.find((m) => costWithVat <= m.maxCost) || sortedMargins[sortedMargins.length - 1];

    const divisor = matchedMargin.divisor;
    const marginLabel = matchedMargin.margin;

    // Bước 5: Giá bán = giá vốn có VAT ÷ hệ số margin
    const quotedPrice = Math.round(divisor > 0 ? costWithVat / divisor : costWithVat);
    const vatAmount = costWithVat - totalProductionCost;
    const subtotalPrice = totalProductionCost;

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

  async generateOptions(input: {
    requestedMatName?: string;
    weightChi?: number;
    laborCost?: number;
    stoneCost?: number;
    stoneDesc?: string;
    vatRate?: number;
    includeVat?: boolean;
    manualBasePrice?: number;
  }) {
    const config = await this.getConfig();
    const metalPrices = await this.metalPricesService.getLatestAsync();

    const w = input.weightChi || 0;
    const l = input.laborCost || 0;
    const s = input.stoneCost || 0;
    const vatVal = input.includeVat ? (input.vatRate ?? 10) : 0;
    const stoneDesc = input.stoneDesc || '';

    const requestedMatName = input.requestedMatName || '';
    const reqLower = requestedMatName.toLowerCase();

    const isGoldReq =
      reqLower.includes('vàng') ||
      reqLower.includes('gold') ||
      (config.goldRatios || []).some(
        (r) =>
          reqLower.includes(r.label?.toLowerCase() || '') ||
          reqLower.includes(r.key?.toLowerCase().replace('gold_', '') || '')
      );
    const isSilverReq = reqLower.includes('bạc') || reqLower.includes('silver');
    const isNonPrecious = requestedMatName ? (!isGoldReq && !isSilverReq) : false;

    if (isNonPrecious) {
      const baseP = input.manualBasePrice || 0;
      const finalPrice = input.includeVat ? Math.round(baseP * (1 + vatVal / 100)) : baseP;
      return [
        {
          optionName: `Phương án 1 (${requestedMatName} - SALE YÊU CẦU)`,
          materialName: requestedMatName,
          weightChi: 0,
          laborCost: baseP,
          stoneCost: 0,
          stoneDescription: '',
          vat: vatVal,
          quotedPrice: finalPrice,
          isSelected: true,
          note: input.includeVat
            ? `Giá gốc ${baseP.toLocaleString('vi-VN')}₫ + VAT ${vatVal}%`
            : `Giá gốc ${baseP.toLocaleString('vi-VN')}₫ (Không VAT)`,
        },
      ];
    }

    if (isSilverReq) {
      // Bạc: quy tắc riêng theo spec — giá bán = giá vốn (giá bạc × trọng lượng) × hệ số nhân bạc.
      // Không cộng tiền công/đá, không VAT, chỉ 1 phương án.
      const totalMetalCost = metalPrices.silverVnd * w;
      const suggestedPrice = Math.round(totalMetalCost * config.silverMultiplier);

      return [
        {
          optionName: `Phương án 1 (Bạc 925 - SALE YÊU CẦU)`,
          materialName: 'Bạc 925',
          weightChi: w,
          laborCost: 0,
          stoneCost: 0,
          stoneDescription: '',
          vat: 0,
          quotedPrice: suggestedPrice,
          isSelected: true,
          note: `Giá vốn × ${config.silverMultiplier} (không cộng công/đá/VAT theo quy tắc riêng của Bạc)`,
        },
      ];
    }

    // Gold Karats
    let requestedKey = 'GOLD_10K';
    if (requestedMatName) {
      const found = (config.goldRatios || []).find(
        (r) =>
          reqLower.includes(r.label.toLowerCase()) ||
          reqLower.includes(r.key.toLowerCase().replace('gold_', ''))
      );
      if (found) requestedKey = found.key;
    }

    const gold24kRate = metalPrices.gold24kVnd;
    const sortedMargins = [...(config.profitMargins || [])].sort((a, b) => a.maxCost - b.maxCost);

    const allGenerated = (config.goldRatios || []).map((ratioObj) => {
      const matName = ratioObj.label || ratioObj.key;
      const isSaleTarget = ratioObj.key === requestedKey;
      const matCost = gold24kRate * ratioObj.applied * w;
      const rawCost = matCost + l + s;
      const vatCost = rawCost * (vatVal / 100);
      const totalCostWithVat = rawCost + vatCost;

      const tier = sortedMargins.find((m) => totalCostWithVat <= m.maxCost) || sortedMargins[sortedMargins.length - 1];
      const divisor = tier ? tier.divisor : 0.8;
      const suggestedPrice = Math.round(totalCostWithVat / divisor);

      return {
        isSaleTarget,
        option: {
          optionName: isSaleTarget ? `Phương án chính (${matName} - SALE YÊU CẦU)` : `Phương án phụ (${matName} - So sánh thêm)`,
          materialName: matName,
          weightChi: w,
          laborCost: l,
          stoneCost: s,
          stoneDescription: stoneDesc,
          vat: vatVal,
          quotedPrice: suggestedPrice,
          isSelected: isSaleTarget,
          note: isSaleTarget ? `Đúng chất liệu Sale yêu cầu` : `Phương án phụ để Sale tư vấn so sánh`,
        },
      };
    });

    allGenerated.sort((a, b) => (b.isSaleTarget ? 1 : 0) - (a.isSaleTarget ? 1 : 0));

    return allGenerated.map((item, idx) => ({
      ...item.option,
      isSelected: idx === 0,
      optionName: item.isSaleTarget
        ? `Phương án ${idx + 1} (${item.option.materialName} - SALE YÊU CẦU)`
        : `Phương án ${idx + 1} (${item.option.materialName} - So sánh thêm)`,
    }));
  }
}
