// Lõi công thức tính giá trang sức — THUẦN (số vào số ra, không DB/DI), sống ở đúng domain
// pricing-formulas thay vì lẫn trong QuoteOptionsService. QuoteOptionsService import hàm ở đây cho
// cả 2 luồng: máy tính giá lúc soạn phương án (calculate5StepPrice/calculateMulti/generateOptions)
// và tính lại giá "sống" cho option đã lưu (batchComputeLivePrices) — luôn theo đúng 1 công thức.
//
// Kim loại gốc nào dùng giá nào tra qua baseMetalId (FK thật trên Material) — không đoán qua tên
// chuỗi nữa, xem BaseMetal/Material.baseMetalId trong schema.

import { BadRequestException } from '@nestjs/common';
import { MarginTier } from '../pricing-formulas/dto/pricing-formula.dto';

// Chuẩn hóa tỷ lệ áp dụng (VD: 40 hoặc 0.40 đều hiểu là 0.40) để tránh lỗi nhân vọt lên hàng tỷ
export function normalizeAppliedRatio(applied: number): number {
  if (!applied || applied <= 0) return 0;
  return applied > 1 ? applied / 100 : applied;
}

// Làm tròn giá bán cuối cùng đến bội số 1.000 VNĐ theo chuẩn tài chính (mục 8.2 tài liệu nghiệp vụ)
export function roundToThousand(n: number): number {
  return Math.round(n / 1000) * 1000;
}

// prices: Map<baseMetalId, giá VNĐ/chỉ> — build từ BaseMetalPriceHistory đang isActive=true
// (xem MetalPricesService.getLatestAsync). baseMetalId null (chất liệu phi kim loại) luôn ra 0.
export function getSpotPrice(
  baseMetalId: string | null,
  prices: Map<string, number>,
): number {
  if (!baseMetalId) return 0;
  return prices.get(baseMetalId) || 0;
}

// Giá đá tách tính riêng khỏi giá kim loại — luôn dùng công thức MẶC ĐỊNH (PricingFormula.isDefault)
// bất kể chất liệu kim loại đi kèm dùng công thức gì (hệ số nhân như Bạc không áp dụng được cho đá)
export function computeStoneSellPrice(
  stoneCost: number,
  vatRate: number,
  defaultTiers: MarginTier[],
): { stonePrice: number; stoneMarginLabel: string } {
  if (!stoneCost) {
    return { stonePrice: 0, stoneMarginLabel: '' };
  }
  const stoneCostWithVat = stoneCost * (1 + vatRate / 100);
  const sorted = [...defaultTiers].sort((a, b) => a.maxCost - b.maxCost);
  const tier =
    sorted.find((m) => stoneCostWithVat <= m.maxCost) ||
    sorted[sorted.length - 1];
  const divisor = tier ? tier.divisor : 1;
  const stonePrice =
    divisor > 0 ? stoneCostWithVat / divisor : stoneCostWithVat;
  return { stonePrice, stoneMarginLabel: tier ? tier.margin : '' };
}

// Chất liệu tối thiểu cần để tính giá — cấu trúc khớp với Material (Prisma) join sẵn pricingFormula
export interface PricingMaterialInput {
  name: string;
  baseMetalId: string | null;
  priceRatioPct: number | string;
  pricingFormula: {
    id?: string;
    name: string;
    formulaType: 'MARGIN_TIERS' | 'MULTIPLIER';
    config: any;
  };
}

// Lõi tính giá dùng chung cho MỌI chất liệu (Vàng/Bạc/Bạch kim/kim loại thêm sau) — kim loại nào
// dùng spot price nào tra qua material.baseMetalId, còn RA GIÁ BÁN dùng công thức lãi gắn trên
// chính chất liệu đó (material.pricingFormula), không hardcode theo tên kim loại.
export function computeMetalQuote(
  baseMetalName: string,
  material: PricingMaterialInput,
  weightChi: number,
  laborCost: number,
  stoneCost: number,
  vatRate: number,
  metalPrices: Map<string, number>,
  silverMultiplierChoice: number | undefined,
  defaultStoneTiers: MarginTier[],
) {
  const spotPrice = getSpotPrice(material.baseMetalId, metalPrices);
  if (!spotPrice || spotPrice <= 0) {
    throw new BadRequestException(
      `Chưa cấu hình đơn giá ${baseMetalName} (VNĐ/chỉ) trong Database.`,
    );
  }

  const metalPricePerChi =
    spotPrice * normalizeAppliedRatio(Number(material.priceRatioPct));
  const metalRawCost = weightChi * metalPricePerChi;
  const totalProductionCost = metalRawCost + laborCost;
  const stoneResult = computeStoneSellPrice(
    stoneCost,
    vatRate,
    defaultStoneTiers,
  );
  const costWithVat = totalProductionCost * (1 + vatRate / 100);
  const vatAmount = costWithVat - totalProductionCost;

  const formula = material.pricingFormula;

  if (formula.formulaType === 'MULTIPLIER') {
    const multipliers: number[] = formula.config?.multipliers || [];
    const chosenMultiplier = silverMultiplierChoice ?? multipliers[0] ?? 3;
    const raw = costWithVat * chosenMultiplier;
    const quotedPrice = roundToThousand(raw + stoneResult.stonePrice);
    return {
      metalPricePerChi,
      metalRawCost,
      totalProductionCost,
      raw,
      stoneResult,
      quotedPrice,
      vatAmount,
      divisor: chosenMultiplier,
      marginLabel: `${material.name}: (giá kim loại + công) có VAT × ${chosenMultiplier}`,
    };
  }

  // MARGIN_TIERS
  const tiers: MarginTier[] = formula.config?.tiers || [];
  if (tiers.length === 0) {
    throw new BadRequestException(
      `Chưa cấu hình bậc lợi nhuận cho công thức "${formula.name}" trong Database.`,
    );
  }
  const sorted = [...tiers].sort((a, b) => a.maxCost - b.maxCost);
  const matchedTier =
    sorted.find((t) => costWithVat <= t.maxCost) || sorted[sorted.length - 1];
  const divisor = matchedTier.divisor;
  const raw = divisor > 0 ? costWithVat / divisor : costWithVat;
  const quotedPrice = roundToThousand(raw + stoneResult.stonePrice);
  return {
    metalPricePerChi,
    metalRawCost,
    totalProductionCost,
    raw,
    stoneResult,
    quotedPrice,
    vatAmount,
    divisor,
    marginLabel: matchedTier.margin,
  };
}
