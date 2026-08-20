import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPricesService } from '../metal-prices/metal-prices.service';
import { CacheWithTtl } from '../common/cache-with-ttl.util';
import { APP_CONSTANTS } from '../common/constants';
import {
  PricingConfigDto,
  CalculatePriceInput,
  PricingCalculationResult,
  CalculateMultiInput,
  CalculateMultiResult,
} from './dto/pricing-config.dto';

// Chuẩn hóa tỷ lệ vàng áp dụng (VD: 40 hoặc 0.40 đều hiểu là 0.40) để tránh lỗi nhân vọt lên hàng tỷ
function normalizeAppliedRatio(applied: number): number {
  if (!applied || applied <= 0) return 0;
  return applied > 1 ? applied / 100 : applied;
}

// Làm tròn giá bán cuối cùng đến bội số 1.000 VNĐ theo chuẩn tài chính (mục 8.2 tài liệu nghiệp vụ)
function roundToThousand(n: number): number {
  return Math.round(n / 1000) * 1000;
}

// Giá đá tách tính riêng khỏi giá kim loại — dùng đúng công thức lợi nhuận như vàng
// (giá đá có VAT ÷ hệ số margin tra theo mức chi phí đá trong bảng profitMargins)
function computeStoneSellPrice(
  stoneCost: number,
  vatRate: number,
  profitMargins: { maxCost: number; divisor: number; margin: string }[],
): { stonePrice: number; stoneMarginLabel: string } {
  if (!stoneCost) {
    return { stonePrice: 0, stoneMarginLabel: '' };
  }
  const stoneCostWithVat = stoneCost * (1 + vatRate / 100);
  const sorted = [...profitMargins].sort((a, b) => a.maxCost - b.maxCost);
  const tier =
    sorted.find((m) => stoneCostWithVat <= m.maxCost) ||
    sorted[sorted.length - 1];
  const divisor = tier ? tier.divisor : 1;
  const stonePrice =
    divisor > 0 ? stoneCostWithVat / divisor : stoneCostWithVat;
  return { stonePrice, stoneMarginLabel: tier ? tier.margin : '' };
}

@Injectable()
export class PricingConfigService {
  private readonly logger = new Logger(PricingConfigService.name);
  private readonly cache = new CacheWithTtl<PricingConfigDto>(
    APP_CONSTANTS.REFERENCE_DATA_TTL,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly metalPricesService: MetalPricesService,
  ) {}

  async getConfig(): Promise<PricingConfigDto> {
    const cached = this.cache.get();
    if (cached) return cached;

    const record = await this.prisma.pricingConfig.findUnique({
      where: { id: 'singleton' },
    });

    if (!record) {
      this.logger.warn('Chưa có cấu hình PricingConfig trong DB');
      throw new NotFoundException(
        'Chưa tìm thấy bản ghi cấu hình trong Database.',
      );
    }

    const config: PricingConfigDto = {
      goldRatios: record.goldRatios as any,
      profitMargins: record.profitMargins as any,
      silverMultipliers: (record.silverMultipliers as any) || [2.5, 3],
      defaultVatRate: Number(record.defaultVatRate),
      updatedAt: record.updatedAt.toISOString(),
    };
    this.cache.set(config);
    return config;
  }

  async updateConfig(
    dto: Partial<PricingConfigDto>,
  ): Promise<PricingConfigDto> {
    const updated = await this.prisma.pricingConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        goldRatios: (dto.goldRatios || []) as any,
        profitMargins: (dto.profitMargins || []) as any,
        silverMultipliers: (dto.silverMultipliers || [2.5, 3]) as any,
        defaultVatRate: dto.defaultVatRate ?? 10,
      },
      update: {
        ...(dto.goldRatios ? { goldRatios: dto.goldRatios as any } : {}),
        ...(dto.profitMargins
          ? { profitMargins: dto.profitMargins as any }
          : {}),
        ...(dto.silverMultipliers
          ? { silverMultipliers: dto.silverMultipliers as any }
          : {}),
        ...(dto.defaultVatRate !== undefined
          ? { defaultVatRate: dto.defaultVatRate }
          : {}),
      },
    });

    this.logger.log(
      'Đã cập nhật cấu hình PricingConfig trực tiếp vào Database PostgreSQL',
    );
    const config: PricingConfigDto = {
      goldRatios: updated.goldRatios as any,
      profitMargins: updated.profitMargins as any,
      silverMultipliers: (updated.silverMultipliers as any) || [2.5, 3],
      defaultVatRate: Number(updated.defaultVatRate),
      updatedAt: updated.updatedAt.toISOString(),
    };
    this.cache.set(config);
    return config;
  }

  /**
   * Động cơ tính giá lõi 5 bước trang sức phụ thuộc 100% vào Database (Không hardcode tỉ lệ/hệ số)
   */
  async calculate5StepPrice(
    input: CalculatePriceInput,
  ): Promise<PricingCalculationResult> {
    const config = await this.getConfig();
    const metalPrices = await this.metalPricesService.getLatestAsync();

    const {
      materialNameOrKey,
      weightChi = 0,
      laborCost = 0,
      stoneCost = 0,
      vatRate = 0,
    } = {
      ...input,
      weightChi: Math.max(0, input.weightChi || 0),
      laborCost: Math.max(0, input.laborCost || 0),
      stoneCost: Math.max(0, input.stoneCost || 0),
      vatRate: Math.max(0, input.vatRate || 0),
    };

    const normalizedMat = (materialNameOrKey || '').trim().toUpperCase();

    // Bạc: quy tắc riêng — giá bán = (giá kim loại + công) × (1 + VAT%) × hệ số nhân Bạc do người dùng chọn. Không qua bảng margin.
    if (
      normalizedMat.includes('PLATINUM') ||
      normalizedMat.includes('BẠCH KIM')
    ) {
      const metalPricePerChi = metalPrices.platinumVnd || 0;
      if (metalPricePerChi <= 0) {
        throw new BadRequestException(
          'Chưa cấu hình  đơn giá Bạch kim (VNĐ/chỉ) trong hệ thống.',
        );
      }
      // Giá vốn kim loại THÔ (trọng lượng × đơn giá, trước công/margin/VAT) — khác totalMetalCost
      // bên dưới (giá BÁN kim loại sau margin, ứng đúng ý nghĩa field QuoteOption.totalMetalCost).
      const metalRawCost = metalPricePerChi * weightChi;
      const totalProductionCost = metalRawCost + laborCost;

      const sortedMargins = [...(config.profitMargins || [])].sort(
        (a, b) => a.maxCost - b.maxCost,
      );
      if (sortedMargins.length === 0) {
        throw new BadRequestException(
          'Chưa cấu hình bảng lợi nhuận profitMargins trong Database.',
        );
      }

      // Bước 4: Thuế VAT — cộng VAT vào giá vốn TRƯỚC khi chọn bậc margin (đúng thứ tự theo spec)
      const costWithVat = totalProductionCost * (1 + vatRate / 100);

      const matchedMargin =
        sortedMargins.find((m) => costWithVat <= m.maxCost) ||
        sortedMargins[sortedMargins.length - 1];

      const divisor = matchedMargin.divisor;
      const marginLabel = matchedMargin.margin;

      // Bước 5: Giá vàng = giá vốn có VAT ÷ hệ số margin. Giá đá tính riêng bằng đúng công thức này
      // (giá đá có VAT ÷ hệ số margin tra theo mức chi phí đá), rồi cộng vào giá vàng.
      const goldRaw = divisor > 0 ? costWithVat / divisor : costWithVat;
      const stoneResult = computeStoneSellPrice(
        stoneCost,
        vatRate,
        sortedMargins,
      );
      const quotedPrice = roundToThousand(goldRaw + stoneResult.stonePrice);
      const vatAmount = costWithVat - totalProductionCost;
      const subtotalPrice = totalProductionCost;

      return {
        materialNameOrKey,
        metalPricePerChi: Math.round(metalPricePerChi),
        totalMetalCost: Math.round(goldRaw),
        metalRawCost: Math.round(metalRawCost),
        laborCost,
        stoneCost,
        stonePrice: Math.round(stoneResult.stonePrice),
        stoneMarginLabel: stoneResult.stoneMarginLabel,
        totalProductionCost: Math.round(totalProductionCost),
        profitMarginDivisor: divisor,
        profitMarginLabel: marginLabel,
        subtotalPrice: Math.round(subtotalPrice),
        vatRate,
        vatAmount: Math.round(vatAmount),
        quotedPrice,
      };
    } else if (
      normalizedMat.includes('BẠC') ||
      normalizedMat.includes('SILVER') ||
      normalizedMat.includes('925')
    ) {
      const chosenMultiplier =
        input.silverMultiplier ?? config.silverMultipliers?.[0] ?? 3;
      const metalPricePerChi = metalPrices.silverVnd;
      const metalRawCost = weightChi * metalPricePerChi;
      const totalProductionCost = metalRawCost + laborCost; // Giá đá tách tính riêng, không gộp vào giá vốn kim loại
      const costWithVat = totalProductionCost * (1 + vatRate / 100);
      const vatAmount = costWithVat - totalProductionCost;
      const silverRaw = costWithVat * chosenMultiplier;
      const stoneResult = computeStoneSellPrice(
        stoneCost,
        vatRate,
        config.profitMargins || [],
      );
      const quotedPrice = roundToThousand(silverRaw + stoneResult.stonePrice);

      return {
        materialNameOrKey,
        metalPricePerChi: Math.round(metalPricePerChi),
        totalMetalCost: Math.round(silverRaw),
        metalRawCost: Math.round(metalRawCost),
        laborCost,
        stoneCost,
        stonePrice: Math.round(stoneResult.stonePrice),
        stoneMarginLabel: stoneResult.stoneMarginLabel,
        totalProductionCost: Math.round(totalProductionCost),
        profitMarginDivisor: chosenMultiplier,
        profitMarginLabel: `Bạc: (giá kim loại + công) có VAT × ${chosenMultiplier}`,
        subtotalPrice: Math.round(totalProductionCost),
        vatRate,
        vatAmount: Math.round(vatAmount),
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
      metalPricePerChi = goldRate * normalizeAppliedRatio(matchedRatio.applied);
    }

    const metalRawCost = weightChi * metalPricePerChi;

    // Bước 2: Tổng chi phí sản xuất (Cost Price) — giá đá tách tính riêng, không gộp vào đây
    const totalProductionCost = metalRawCost + laborCost;

    // Bước 3: Áp dụng Lợi nhuận (Profit Margin) động từ DB
    const sortedMargins = [...(config.profitMargins || [])].sort(
      (a, b) => a.maxCost - b.maxCost,
    );
    if (sortedMargins.length === 0) {
      throw new BadRequestException(
        'Chưa cấu hình bảng lợi nhuận profitMargins trong Database.',
      );
    }

    // Bước 4: Thuế VAT — cộng VAT vào giá vốn TRƯỚC khi chọn bậc margin (đúng thứ tự theo spec)
    const costWithVat = totalProductionCost * (1 + vatRate / 100);

    const matchedMargin =
      sortedMargins.find((m) => costWithVat <= m.maxCost) ||
      sortedMargins[sortedMargins.length - 1];

    const divisor = matchedMargin.divisor;
    const marginLabel = matchedMargin.margin;

    // Bước 5: Giá vàng = giá vốn có VAT ÷ hệ số margin. Giá đá tính riêng bằng đúng công thức này
    // (giá đá có VAT ÷ hệ số margin tra theo mức chi phí đá), rồi cộng vào giá vàng.
    const goldRaw = divisor > 0 ? costWithVat / divisor : costWithVat;
    const stoneResult = computeStoneSellPrice(
      stoneCost,
      vatRate,
      sortedMargins,
    );
    const quotedPrice = roundToThousand(goldRaw + stoneResult.stonePrice);
    const vatAmount = costWithVat - totalProductionCost;
    const subtotalPrice = totalProductionCost;

    return {
      materialNameOrKey,
      metalPricePerChi: Math.round(metalPricePerChi),
      totalMetalCost: Math.round(goldRaw),
      metalRawCost: Math.round(metalRawCost),
      laborCost,
      stoneCost,
      stonePrice: Math.round(stoneResult.stonePrice),
      stoneMarginLabel: stoneResult.stoneMarginLabel,
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
    silverMultiplier?: number;
  }) {
    const config = await this.getConfig();
    const metalPrices = await this.metalPricesService.getLatestAsync();
    const gold24kRate = metalPrices.gold24kVnd;

    const w = Math.max(0, input.weightChi || 0);
    const l = Math.max(0, input.laborCost || 0);
    const s = Math.max(0, input.stoneCost || 0);
    const vatVal = input.includeVat ? Math.max(0, input.vatRate ?? 10) : 0;
    const stoneDesc = input.stoneDesc || '';
    const sortedMargins = [...(config.profitMargins || [])].sort(
      (a, b) => a.maxCost - b.maxCost,
    );
    const stoneResult = computeStoneSellPrice(s, vatVal, sortedMargins);
    const requestedMatName = input.requestedMatName || '';
    const reqLower = requestedMatName.toLowerCase();

    // 1. Nhận diện Bạch kim
    const isPlatinumReq =
      reqLower.includes('bạch kim') ||
      reqLower.includes('platinum') ||
      reqLower.includes('platin') ||
      reqLower.includes('pt');

    // 2. Nhận diện Bạc (Loại trừ Bạch kim)
    const isSilverReq =
      !isPlatinumReq &&
      ((reqLower.includes('bạc') && !reqLower.includes('bạch')) ||
        reqLower.includes('silver') ||
        reqLower.includes('925'));

    // 3. Nhận diện Vàng
    const isGoldReq =
      !isPlatinumReq &&
      !isSilverReq &&
      (reqLower.includes('vàng') ||
        reqLower.includes('gold') ||
        (config.goldRatios || []).some(
          (r) =>
            reqLower.includes(r.label?.toLowerCase() || '') ||
            reqLower.includes(r.key?.toLowerCase().replace('gold_', '') || ''),
        ));

    const isNonPrecious = requestedMatName
      ? !isGoldReq && !isSilverReq && !isPlatinumReq
      : false;
    if (isNonPrecious) {
      const baseP = input.manualBasePrice || 0;
      const finalPrice = input.includeVat
        ? roundToThousand(baseP * (1 + vatVal / 100))
        : roundToThousand(baseP);
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
      // Bạc: giá kim loại = (giá kim loại + công) có VAT × hệ số nhân Bạc do người dùng chọn (silverMultipliers).
      // Giá đá tách tính riêng theo bảng lợi nhuận (giống vàng), cộng vào sau. Chỉ 1 phương án theo hệ số đã chọn.
      const chosenMultiplier =
        input.silverMultiplier ?? config.silverMultipliers?.[0] ?? 3;
      const totalMetalCost = metalPrices.silverVnd * w;
      const totalProductionCost = totalMetalCost + l;
      const costWithVat = totalProductionCost * (1 + vatVal / 100);
      const stoneResult = computeStoneSellPrice(
        s,
        vatVal,
        config.profitMargins || [],
      );
      const silverSellPrice = costWithVat * chosenMultiplier;
      const quotedPrice = roundToThousand(
        silverSellPrice + stoneResult.stonePrice,
      );
      const silverMultiplier =
        input.silverMultiplier ||
        (Array.isArray(config.silverMultipliers) &&
        config.silverMultipliers.length > 0
          ? config.silverMultipliers[0]
          : 3);
      const silverPerChi = metalPrices.silverVnd;
      const silverMetalCost = w * silverPerChi;
      const silverProductionCost = silverMetalCost + l;
      const silverWithVat = silverProductionCost * (1 + vatVal / 100);
      const silverSuggested = roundToThousand(
        silverWithVat * silverMultiplier + stoneResult.stonePrice,
      );

      return [
        {
          optionName: 'Phương án Bạc 925 (SALE YÊU CẦU)',
          materialName: 'Bạc 925',
          weightChi: w,
          laborCost: l,
          stoneCost: s,
          stoneDescription: stoneDesc,
          totalMetalCost: Math.round(silverWithVat * silverMultiplier),
          metalRawCost: Math.round(silverMetalCost),
          stonePrice: Math.round(stoneResult.stonePrice),
          vat: vatVal,
          quotedPrice: silverSuggested,
          isSelected: true,
          note: `Hệ số nhân Bạc: × ${silverMultiplier}`,
        },
      ];
    }

    // B. Nếu yêu cầu là BẠCH KIM (Platinum)
    if (isPlatinumReq) {
      const platPerChi = metalPrices.platinumVnd || 0;
      if (platPerChi <= 0) {
        throw new BadRequestException(
          'Chưa cấu hình đơn giá Bạch kim (VNĐ/chỉ) trong Database.',
        );
      }
      const platMetalCost = w * platPerChi;
      const platProductionCost = platMetalCost + l;
      const platWithVat = platProductionCost * (1 + vatVal / 100);

      const tier =
        sortedMargins.find((m) => platWithVat <= m.maxCost) ||
        sortedMargins[sortedMargins.length - 1];
      const divisor = tier ? tier.divisor : 0.8;
      const platRaw = platWithVat / divisor;
      const platSuggested = roundToThousand(platRaw + stoneResult.stonePrice);

      return [
        {
          optionName: 'Phương án Bạch kim (SALE YÊU CẦU)',
          materialName: 'Bạch kim (Platinum)',
          weightChi: w,
          laborCost: l,
          stoneCost: s,
          stoneDescription: stoneDesc,
          totalMetalCost: Math.round(platRaw),
          metalRawCost: Math.round(platMetalCost),
          stonePrice: Math.round(stoneResult.stonePrice),
          vat: vatVal,
          quotedPrice: platSuggested,
          isSelected: true,
          note: `Đúng chất liệu Sale yêu cầu`,
        },
      ];
    }

    // C. Nếu yêu cầu là VÀNG (hoặc chất liệu khác)
    const allGenerated = (config.goldRatios || []).map((r) => {
      const key = (r.key || '').toUpperCase();
      const label = (r.label || '').toUpperCase();
      const keyClean = key.replace('GOLD_', '');
      const isSaleTarget =
        isGoldReq &&
        (reqLower.includes(key.toLowerCase()) ||
          reqLower.includes(label.toLowerCase()) ||
          reqLower.includes(keyClean.toLowerCase()));

      const matName = r.label || r.key;
      const matPricePerChi = gold24kRate * normalizeAppliedRatio(r.applied);
      const matCost = w * matPricePerChi;
      const totalCost = matCost + l;
      const totalCostWithVat = totalCost * (1 + vatVal / 100);

      const tier =
        sortedMargins.find((m) => totalCostWithVat <= m.maxCost) ||
        sortedMargins[sortedMargins.length - 1];
      const divisor = tier ? tier.divisor : 0.8;
      const goldRaw = totalCostWithVat / divisor;
      const suggestedPrice = roundToThousand(goldRaw + stoneResult.stonePrice);

      return {
        isSaleTarget,
        option: {
          optionName: isSaleTarget
            ? `Phương án chính (${matName} - SALE YÊU CẦU)`
            : `Phương đề xuất (${matName} - So sánh thêm)`,
          materialName: matName,
          weightChi: w,
          laborCost: l,
          stoneCost: s,
          stoneDescription: stoneDesc,
          // Giá bán cuối (kim loại + công, đã qua margin/VAT) — cộng với stonePrice ra đúng quotedPrice
          totalMetalCost: Math.round(goldRaw),
          metalRawCost: Math.round(matCost),
          stonePrice: Math.round(stoneResult.stonePrice),
          vat: vatVal,
          quotedPrice: suggestedPrice,
          isSelected: isSaleTarget,
          note: isSaleTarget
            ? `Đúng chất liệu Sale yêu cầu`
            : `Phương đề xuất để Sale tư vấn so sánh`,
        },
      };
    });

    allGenerated.sort(
      (a, b) => (b.isSaleTarget ? 1 : 0) - (a.isSaleTarget ? 1 : 0),
    );

    return allGenerated.map((item, idx) => ({
      ...item.option,
      isSelected: idx === 0,
      optionName: item.isSaleTarget
        ? `Phương án ${idx + 1} (${item.option.materialName} - SALE YÊU CẦU)`
        : `Phương án ${idx + 1} (${item.option.materialName} - So sánh thêm)`,
    }));
  }

  /**
   * Tính giá cho yêu cầu nhiều chất liệu (vd Vàng 10K + 12K + 14K trong 1 sản phẩm) —
   * cộng dồn giá kim loại từng chất liệu (đúng công thức tuổi vàng như luồng 1 chất liệu),
   * rồi áp margin/VAT/giá đá 1 lần duy nhất trên tổng. Không hỗ trợ trộn Bạc trong danh sách
   * nhiều chất liệu (Bạc dùng công thức nhân hệ số riêng, không tương thích với cộng dồn margin).
   */
  async calculateMulti(
    input: CalculateMultiInput,
  ): Promise<CalculateMultiResult> {
    if (!input.materials || input.materials.length === 0) {
      throw new BadRequestException('Cần ít nhất 1 chất liệu để tính giá');
    }

    if (input.manualStoneName && input.stones && input.stones.length > 0) {
      throw new BadRequestException(
        'Chỉ được chọn 1 trong 2 cách nhập đá: nhập tay hoặc chọn từ danh mục',
      );
    }

    const config = await this.getConfig();
    const metalPrices = await this.metalPricesService.getLatestAsync();
    const gold24kRate = metalPrices.gold24kVnd;

    const laborCost = Math.max(0, input.laborCost || 0);
    const vatRate = input.includeVat ? Math.max(0, input.vatRate ?? 10) : 0;

    let totalMetalCost = 0;
    const breakdown: CalculateMultiResult['breakdown'] = [];

    for (const item of input.materials) {
      if (!item.weightChi || item.weightChi <= 0) {
        throw new BadRequestException(
          `Khối lượng chất liệu "${item.materialName}" phải lớn hơn 0`,
        );
      }

      const normalizedMat = (item.materialName || '').trim().toUpperCase();
      const isPlatinum =
        normalizedMat.includes('PLATINUM') ||
        normalizedMat.includes('BẠCH KIM') ||
        normalizedMat.includes('PLATIN') ||
        normalizedMat.includes('PT');

      const isSilver =
        !isPlatinum &&
        ((normalizedMat.includes('BẠC') && !normalizedMat.includes('BẠCH')) ||
          normalizedMat.includes('SILVER') ||
          normalizedMat.includes('925'));

      if (isSilver) {
        throw new BadRequestException(
          `Chất liệu "${item.materialName}" là Bạc — chưa hỗ trợ trộn chung Bạc với nhiều chất liệu trong 1 lần tính. Vui lòng dùng luồng báo giá 1 chất liệu.`,
        );
      }

      let metalPricePerChi = 0;
      if (isPlatinum) {
        metalPricePerChi = metalPrices.platinumVnd || 0;
        if (metalPricePerChi <= 0) {
          throw new BadRequestException(
            'Chưa cấu hình đơn giá Bạch kim (VNĐ/chỉ) trong Database.',
          );
        }
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
            `Không tìm thấy cấu hình tỷ lệ áp dụng cho chất liệu "${item.materialName}" trong Database.`,
          );
        }
        metalPricePerChi = gold24kRate * normalizeAppliedRatio(matchedRatio.applied);
      }

      const cost = Math.max(0, item.weightChi) * metalPricePerChi;
      totalMetalCost += cost;
      breakdown.push({
        materialId: item.materialId,
        materialName: item.materialName,
        weightChi: Math.max(0, item.weightChi),
        cost: Math.round(cost),
      });
    }

    let stoneCost = 0;
    if (input.manualStoneName) {
      stoneCost = Math.max(0, input.manualStonePrice || 0);
    } else if (input.stones && input.stones.length > 0) {
      const stoneIds = input.stones.map((s) => s.stoneId);
      const stoneRecords = await this.prisma.stone.findMany({
        where: { id: { in: stoneIds } },
      });
      for (const sel of input.stones) {
        const record = stoneRecords.find((s) => s.id === sel.stoneId);
        if (!record) {
          throw new BadRequestException(
            `Không tìm thấy đá với id "${sel.stoneId}" trong danh mục`,
          );
        }
        stoneCost += Number(record.price) * Math.max(1, sel.quantity || 1);
      }
    }

    const totalProductionCost = totalMetalCost + laborCost;
    const sortedMargins = [...(config.profitMargins || [])].sort(
      (a, b) => a.maxCost - b.maxCost,
    );
    if (sortedMargins.length === 0) {
      throw new BadRequestException(
        'Chưa cấu hình bảng lợi nhuận profitMargins trong Database.',
      );
    }

    const costWithVat = totalProductionCost * (1 + vatRate / 100);
    const matchedMargin =
      sortedMargins.find((m) => costWithVat <= m.maxCost) ||
      sortedMargins[sortedMargins.length - 1];
    const divisor = matchedMargin.divisor;
    const goldRaw = divisor > 0 ? costWithVat / divisor : costWithVat;

    const stoneResult = computeStoneSellPrice(
      stoneCost,
      vatRate,
      sortedMargins,
    );
    const quotedPrice = roundToThousand(goldRaw + stoneResult.stonePrice);
    const vatAmount = costWithVat - totalProductionCost;

    return {
      // totalMetalCost trả về là GIÁ BÁN cuối của phần kim loại+công (đã gồm margin/VAT) —
      // để totalMetalCost + stonePrice cộng thẳng ra đúng quotedPrice. breakdown[].cost vẫn là
      // giá vốn thô từng chất liệu (thành phần cấu tạo, không phải giá bán riêng).
      totalMetalCost: Math.round(goldRaw),
      metalRawCost: Math.round(totalMetalCost),
      stoneCost: Math.round(stoneCost),
      stonePrice: Math.round(stoneResult.stonePrice),
      laborCost,
      vatAmount: Math.round(vatAmount),
      quotedPrice,
      breakdown,
    };
  }
}
