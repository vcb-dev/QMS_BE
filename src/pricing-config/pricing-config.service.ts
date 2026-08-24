import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPricesService } from '../metal-prices/metal-prices.service';
import { MaterialsService } from '../materials/materials.service';
import { PricingFormulasService } from '../pricing-formulas/pricing-formulas.service';
import {
  classifyMaterialType,
  MaterialMetalType,
} from '../materials/material-type.util';
import { MetalPrices } from '../metal-prices/dto/metal-prices.dto';
import { MarginTier } from '../pricing-formulas/dto/pricing-formula.dto';
import {
  CalculatePriceInput,
  PricingCalculationResult,
  CalculateMultiInput,
  CalculateMultiResult,
} from './dto/pricing-config.dto';

type ResolvedMaterial = Awaited<
  ReturnType<MaterialsService['findAll']>
>[number];

// Chuẩn hóa tỷ lệ áp dụng (VD: 40 hoặc 0.40 đều hiểu là 0.40) để tránh lỗi nhân vọt lên hàng tỷ
function normalizeAppliedRatio(applied: number): number {
  if (!applied || applied <= 0) return 0;
  return applied > 1 ? applied / 100 : applied;
}

// Làm tròn giá bán cuối cùng đến bội số 1.000 VNĐ theo chuẩn tài chính (mục 8.2 tài liệu nghiệp vụ)
function roundToThousand(n: number): number {
  return Math.round(n / 1000) * 1000;
}

// Giá đá tách tính riêng khỏi giá kim loại — luôn dùng công thức MẶC ĐỊNH (PricingFormula.isDefault)
// bất kể chất liệu kim loại đi kèm dùng công thức gì (hệ số nhân như Bạc không áp dụng được cho đá)
function computeStoneSellPrice(
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

const METAL_TYPE_LABEL: Record<string, string> = {
  GOLD: 'Vàng 24K',
  SILVER: 'Bạc',
  PLATINUM: 'Bạch kim',
};

@Injectable()
export class PricingConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metalPricesService: MetalPricesService,
    private readonly materialsService: MaterialsService,
    private readonly pricingFormulasService: PricingFormulasService,
  ) {}

  // Tra 1 chất liệu theo tên/text yêu cầu — phân loại kim loại (Vàng/Bạc/Bạch kim) từ chính text
  // yêu cầu trước, rồi mới so khớp tên trong PHẠM VI chất liệu cùng loại kim loại đó. Tách bước
  // phân loại trước để tránh nhầm "Bạc" khớp nhầm vào "Bạch kim" (｢bạc｣ là tiền tố của ｢bạch｣).
  private async resolveMaterial(materialNameOrKey: string): Promise<{
    material: ResolvedMaterial;
    metalType: MaterialMetalType;
  } | null> {
    const metalType = classifyMaterialType(materialNameOrKey);
    if (metalType === 'OTHER') return null;

    const normalizedMat = (materialNameOrKey || '').trim().toUpperCase();
    const materials = await this.materialsService.findAll();
    const candidates = materials.filter(
      (m) => classifyMaterialType(m.name) === metalType,
    );
    const matched = candidates.find((m) => {
      const matUpper = m.name.trim().toUpperCase();
      return (
        normalizedMat.includes(matUpper) || matUpper.includes(normalizedMat)
      );
    });
    if (!matched) return null;
    return { material: matched, metalType };
  }

  private getSpotPrice(
    metalType: MaterialMetalType,
    metalPrices: MetalPrices,
  ): number {
    if (metalType === 'GOLD') return metalPrices.gold24kVnd;
    if (metalType === 'SILVER') return metalPrices.silverVnd;
    if (metalType === 'PLATINUM') return metalPrices.platinumVnd;
    return 0;
  }

  private async getDefaultStoneTiers(): Promise<MarginTier[]> {
    const defaultFormula = await this.pricingFormulasService.getDefault();
    return ((defaultFormula.config as any)?.tiers || []) as MarginTier[];
  }

  // Lõi tính giá dùng chung cho MỌI chất liệu (Vàng/Bạc/Bạch kim/kim loại thêm sau) — kim loại
  // nào dùng spot price nào tra theo metalType, còn RA GIÁ BÁN dùng công thức lãi gắn trên chính
  // chất liệu đó (material.pricingFormula), không hardcode theo tên kim loại nữa. Thêm 1 chất
  // liệu/kim loại mới chỉ cần trỏ formulaId có sẵn hoặc tạo formula mới — không sửa hàm này.
  private computeMetalQuote(
    metalType: MaterialMetalType,
    material: ResolvedMaterial,
    weightChi: number,
    laborCost: number,
    stoneCost: number,
    vatRate: number,
    metalPrices: MetalPrices,
    silverMultiplierChoice: number | undefined,
    defaultStoneTiers: MarginTier[],
  ) {
    const spotPrice = this.getSpotPrice(metalType, metalPrices);
    if (!spotPrice || spotPrice <= 0) {
      throw new BadRequestException(
        `Chưa cấu hình đơn giá ${METAL_TYPE_LABEL[metalType] || metalType} (VNĐ/chỉ) trong Database.`,
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

    const formula = (material as any).pricingFormula as {
      name: string;
      formulaType: 'MARGIN_TIERS' | 'MULTIPLIER';
      config: any;
    };

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

  // Danh sách hệ số nhân Bạc để Sale chọn lúc báo giá — tra theo chất liệu Bạc thật trong DB,
  // không còn 1 mảng cấu hình global tách rời (đổi hệ số/thêm kim loại khác dùng hệ số nhân
  // chỉ cần sửa PricingFormula, không đụng hàm này)
  async getSilverMultipliers(): Promise<number[]> {
    const materials = await this.materialsService.findAll();
    const silverMaterial = materials.find(
      (m) => classifyMaterialType(m.name) === 'SILVER',
    );
    const formula = (silverMaterial as any)?.pricingFormula;
    if (!formula || formula.formulaType !== 'MULTIPLIER') return [];
    return (formula.config?.multipliers || []) as number[];
  }

  /**
   * Động cơ tính giá lõi 5 bước trang sức phụ thuộc 100% vào Database (Không hardcode tỉ lệ/hệ số)
   */
  async calculate5StepPrice(
    input: CalculatePriceInput,
  ): Promise<PricingCalculationResult> {
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

    const resolved = await this.resolveMaterial(materialNameOrKey);
    if (!resolved) {
      throw new BadRequestException(
        `Không tìm thấy cấu hình tỷ lệ áp dụng cho chất liệu "${materialNameOrKey}" trong Database.`,
      );
    }

    const defaultStoneTiers = await this.getDefaultStoneTiers();
    const result = this.computeMetalQuote(
      resolved.metalType,
      resolved.material,
      weightChi,
      laborCost,
      stoneCost,
      vatRate,
      metalPrices,
      input.silverMultiplier,
      defaultStoneTiers,
    );

    return {
      materialNameOrKey,
      metalPricePerChi: Math.round(result.metalPricePerChi),
      totalMetalCost: Math.round(result.raw),
      metalRawCost: Math.round(result.metalRawCost),
      laborCost,
      stoneCost,
      stonePrice: Math.round(result.stoneResult.stonePrice),
      stoneMarginLabel: result.stoneResult.stoneMarginLabel,
      totalProductionCost: Math.round(result.totalProductionCost),
      profitMarginDivisor: result.divisor,
      profitMarginLabel: result.marginLabel,
      subtotalPrice: Math.round(result.totalProductionCost),
      vatRate,
      vatAmount: Math.round(result.vatAmount),
      quotedPrice: result.quotedPrice,
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
    const metalPrices = await this.metalPricesService.getLatestAsync();
    const allMaterials = await this.materialsService.findAll();
    const defaultStoneTiers = await this.getDefaultStoneTiers();

    const w = Math.max(0, input.weightChi || 0);
    const l = Math.max(0, input.laborCost || 0);
    const s = Math.max(0, input.stoneCost || 0);
    const vatVal = input.includeVat ? Math.max(0, input.vatRate ?? 10) : 0;
    const stoneDesc = input.stoneDesc || '';
    const requestedMatName = input.requestedMatName || '';
    const reqLower = requestedMatName.toLowerCase();
    const reqMetalType = classifyMaterialType(requestedMatName);

    const isNonPrecious = requestedMatName ? reqMetalType === 'OTHER' : false;
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

    // Bạc/Bạch kim (hoặc kim loại khác thêm sau, miễn có đúng 1 chất liệu khớp) — chỉ 1 phương án
    if (reqMetalType === 'SILVER' || reqMetalType === 'PLATINUM') {
      const resolved = await this.resolveMaterial(requestedMatName);
      if (!resolved) {
        throw new BadRequestException(
          `Không tìm thấy cấu hình cho chất liệu "${requestedMatName}" trong Database.`,
        );
      }
      const result = this.computeMetalQuote(
        resolved.metalType,
        resolved.material,
        w,
        l,
        s,
        vatVal,
        metalPrices,
        input.silverMultiplier,
        defaultStoneTiers,
      );
      return [
        {
          optionName: `Phương án ${resolved.material.name} (SALE YÊU CẦU)`,
          materialName: resolved.material.name,
          weightChi: w,
          laborCost: l,
          stoneCost: s,
          stoneDescription: stoneDesc,
          totalMetalCost: Math.round(result.raw),
          metalRawCost: Math.round(result.metalRawCost),
          stonePrice: Math.round(result.stoneResult.stonePrice),
          vat: vatVal,
          quotedPrice: result.quotedPrice,
          isSelected: true,
          note: result.marginLabel,
        },
      ];
    }

    // Vàng (hoặc yêu cầu chung chung không rõ kim loại) — dựng nhiều phương án so sánh theo tuổi vàng
    const goldMaterials = allMaterials.filter(
      (m) => classifyMaterialType(m.name) === 'GOLD',
    );
    const isGoldReq = reqMetalType === 'GOLD';

    const allGenerated = goldMaterials.map((mat) => {
      const isSaleTarget =
        isGoldReq && reqLower.includes(mat.name.toLowerCase());
      const result = this.computeMetalQuote(
        'GOLD',
        mat,
        w,
        l,
        s,
        vatVal,
        metalPrices,
        undefined,
        defaultStoneTiers,
      );

      return {
        isSaleTarget,
        option: {
          optionName: isSaleTarget
            ? `Phương án chính (${mat.name} - SALE YÊU CẦU)`
            : `Phương đề xuất (${mat.name} - So sánh thêm)`,
          materialName: mat.name,
          weightChi: w,
          laborCost: l,
          stoneCost: s,
          stoneDescription: stoneDesc,
          totalMetalCost: Math.round(result.raw),
          metalRawCost: Math.round(result.metalRawCost),
          stonePrice: Math.round(result.stoneResult.stonePrice),
          vat: vatVal,
          quotedPrice: result.quotedPrice,
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
   * cộng dồn giá kim loại từng chất liệu, rồi áp margin/VAT/giá đá 1 lần duy nhất trên tổng.
   * Yêu cầu mọi chất liệu trong danh sách dùng CHUNG 1 công thức MARGIN_TIERS — không gộp được
   * chất liệu dùng công thức hệ số nhân (như Bạc), và không gộp được 2 công thức tier khác nhau
   * (tổng chi phí chỉ tra được đúng 1 bảng bậc lợi nhuận).
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

    const metalPrices = await this.metalPricesService.getLatestAsync();
    const laborCost = Math.max(0, input.laborCost || 0);
    const vatRate = input.includeVat ? Math.max(0, input.vatRate ?? 10) : 0;

    let totalMetalCost = 0;
    const breakdown: CalculateMultiResult['breakdown'] = [];
    let sharedFormulaId: string | null = null;
    let sharedFormulaName = '';

    for (const item of input.materials) {
      if (!item.weightChi || item.weightChi <= 0) {
        throw new BadRequestException(
          `Khối lượng chất liệu "${item.materialName}" phải lớn hơn 0`,
        );
      }

      const resolved = await this.resolveMaterial(item.materialName);
      if (!resolved) {
        throw new BadRequestException(
          `Không tìm thấy cấu hình tỷ lệ áp dụng cho chất liệu "${item.materialName}" trong Database.`,
        );
      }
      const { material, metalType } = resolved;
      const formula = (material as any).pricingFormula;

      if (formula.formulaType === 'MULTIPLIER') {
        throw new BadRequestException(
          `Chất liệu "${item.materialName}" dùng công thức hệ số nhân — chưa hỗ trợ trộn chung nhiều chất liệu trong 1 lần tính. Vui lòng dùng luồng báo giá 1 chất liệu.`,
        );
      }
      if (sharedFormulaId === null) {
        sharedFormulaId = formula.id;
        sharedFormulaName = formula.name;
      } else if (sharedFormulaId !== formula.id) {
        throw new BadRequestException(
          `Chất liệu "${item.materialName}" dùng công thức tính lãi khác ("${formula.name}" so với "${sharedFormulaName}") — không gộp được trong 1 lần tính.`,
        );
      }

      const spotPrice = this.getSpotPrice(metalType, metalPrices);
      if (!spotPrice || spotPrice <= 0) {
        throw new BadRequestException(
          `Chưa cấu hình đơn giá ${METAL_TYPE_LABEL[metalType] || metalType} (VNĐ/chỉ) trong Database.`,
        );
      }
      const metalPricePerChi =
        spotPrice * normalizeAppliedRatio(Number(material.priceRatioPct));
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
    const sharedFormula = await this.prisma.pricingFormula.findUniqueOrThrow({
      where: { id: sharedFormulaId! },
    });
    const tiers = ((sharedFormula.config as any)?.tiers || []) as MarginTier[];
    if (tiers.length === 0) {
      throw new BadRequestException(
        `Chưa cấu hình bậc lợi nhuận cho công thức "${sharedFormula.name}" trong Database.`,
      );
    }
    const sorted = [...tiers].sort((a, b) => a.maxCost - b.maxCost);
    const costWithVat = totalProductionCost * (1 + vatRate / 100);
    const matchedTier =
      sorted.find((t) => costWithVat <= t.maxCost) || sorted[sorted.length - 1];
    const divisor = matchedTier.divisor;
    const raw = divisor > 0 ? costWithVat / divisor : costWithVat;
    const vatAmount = costWithVat - totalProductionCost;

    const defaultStoneTiers = await this.getDefaultStoneTiers();
    const stoneResult = computeStoneSellPrice(
      stoneCost,
      vatRate,
      defaultStoneTiers,
    );
    const quotedPrice = roundToThousand(raw + stoneResult.stonePrice);

    return {
      // totalMetalCost trả về là GIÁ BÁN cuối của phần kim loại+công (đã gồm margin/VAT) —
      // để totalMetalCost + stonePrice cộng thẳng ra đúng quotedPrice. breakdown[].cost vẫn là
      // giá vốn thô từng chất liệu (thành phần cấu tạo, không phải giá bán riêng).
      totalMetalCost: Math.round(raw),
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
