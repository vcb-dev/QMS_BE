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
): {
  stonePrice: number;
  stoneMarginLabel: string;
  // VAT phần đá + tiền lãi phần đá — trả sẵn để FE chỉ hiển thị, không tự tính lại.
  stoneVatAmount: number;
  stoneProfit: number;
} {
  if (!stoneCost) {
    return {
      stonePrice: 0,
      stoneMarginLabel: '',
      stoneVatAmount: 0,
      stoneProfit: 0,
    };
  }
  const stoneCostWithVat = stoneCost * (1 + vatRate / 100);
  const sorted = [...defaultTiers].sort((a, b) => a.maxCost - b.maxCost);
  const tier =
    sorted.find((m) => stoneCostWithVat <= m.maxCost) ||
    sorted[sorted.length - 1];
  const divisor = tier ? tier.divisor : 1;
  const stonePrice =
    divisor > 0 ? stoneCostWithVat / divisor : stoneCostWithVat;
  return {
    stonePrice,
    stoneMarginLabel: tier ? tier.margin : '',
    stoneVatAmount: stoneCostWithVat - stoneCost,
    stoneProfit: stonePrice - stoneCostWithVat,
  };
}

// Áp bậc lợi nhuận MARGIN_TIERS lên (giá vốn kim loại + tiền công), rồi cộng giá đá đã tính lãi
// riêng — LÕI CHUNG cho cả 3 luồng: computeMetalQuote (1 chất liệu), QuoteOptionsService.calculateMulti
// và batchComputeLivePrices (gộp nhiều chất liệu). Trước đây 3 nơi tự lặp y hệt: sort tiers ->
// costWithVat -> matchedTier -> divisor -> raw -> computeStoneSellPrice -> roundToThousand.
// `tiers` PHẢI khác rỗng (caller tự kiểm + tự quyết ném lỗi hay trả null).
export function applyMarginTiers(
  metalRawCost: number,
  laborCost: number,
  vatRate: number,
  tiers: MarginTier[],
  stoneCost: number,
  defaultStoneTiers: MarginTier[],
): {
  totalProductionCost: number;
  costWithVat: number;
  vatAmount: number;
  // Tiền lãi phần kim loại (giá bán kim loại+công - chi phí đã gồm VAT) — trả sẵn cho FE.
  metalProfit: number;
  divisor: number;
  marginLabel: string;
  raw: number;
  stoneResult: ReturnType<typeof computeStoneSellPrice>;
  quotedPrice: number;
} {
  const totalProductionCost = metalRawCost + laborCost;
  const costWithVat = totalProductionCost * (1 + vatRate / 100);
  const vatAmount = costWithVat - totalProductionCost;
  const sorted = [...tiers].sort((a, b) => a.maxCost - b.maxCost);
  const matchedTier =
    sorted.find((t) => costWithVat <= t.maxCost) || sorted[sorted.length - 1];
  const divisor = matchedTier?.divisor ?? 1;
  const raw = divisor > 0 ? costWithVat / divisor : costWithVat;
  const stoneResult = computeStoneSellPrice(
    stoneCost,
    vatRate,
    defaultStoneTiers,
  );
  const quotedPrice = roundToThousand(raw + stoneResult.stonePrice);
  return {
    totalProductionCost,
    costWithVat,
    vatAmount,
    metalProfit: raw - costWithVat,
    divisor,
    marginLabel: matchedTier?.margin ?? '',
    raw,
    stoneResult,
    quotedPrice,
  };
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
  const formula = material.pricingFormula;

  if (formula.formulaType === 'MULTIPLIER') {
    const totalProductionCost = metalRawCost + laborCost;
    const costWithVat = totalProductionCost * (1 + vatRate / 100);
    const vatAmount = costWithVat - totalProductionCost;
    const stoneResult = computeStoneSellPrice(
      stoneCost,
      vatRate,
      defaultStoneTiers,
    );
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
      metalProfit: raw - costWithVat,
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
  const m = applyMarginTiers(
    metalRawCost,
    laborCost,
    vatRate,
    tiers,
    stoneCost,
    defaultStoneTiers,
  );
  return {
    metalPricePerChi,
    metalRawCost,
    totalProductionCost: m.totalProductionCost,
    raw: m.raw,
    stoneResult: m.stoneResult,
    quotedPrice: m.quotedPrice,
    vatAmount: m.vatAmount,
    metalProfit: m.metalProfit,
    divisor: m.divisor,
    marginLabel: m.marginLabel,
  };
}
