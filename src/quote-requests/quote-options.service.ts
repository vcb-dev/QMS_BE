// Gom mọi logic quanh QuoteOption cần DB/service khác: tính giá cho 1 phương án đang soạn (Sale/
// Order dùng máy tính giá trước khi lưu), snapshot giá đá lúc báo giá, và tính lại giá "sống" theo
// config hiện tại cho option đã lưu (Quản Lý Sản Phẩm). Phần mapping/build input thuần (không cần
// DI) vẫn ở utils/option-mapper.util.ts. Công thức toán lõi nằm ở pricing-formulas/pricing-math.util
// (dùng chung, không lặp lại ở đây).

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPricesService } from '../metal-prices/metal-prices.service';
import { MaterialsService } from '../materials/materials.service';
import { PricingFormulasService } from '../pricing-formulas/pricing-formulas.service';
import { StonesService } from '../stones/stones.service';
import {
  computeMetalQuote,
  computeStoneSellPrice,
  getSpotPrice,
  normalizeAppliedRatio,
  roundToThousand,
} from '../utils/pricing-math.util';
import { MarginTier } from '../pricing-formulas/dto/pricing-formula.dto';
import {
  CalculatePriceInput,
  PricingCalculationResult,
  CalculateMultiInput,
  CalculateMultiResult,
} from './dto/calculate-price.dto';

type ResolvedMaterial = Awaited<
  ReturnType<MaterialsService['findAll']>
>[number];

// Đầu vào tính giá "sống" cho 1 phương án báo giá đã lưu — dữ liệu lấy thẳng từ QuoteOption đã
// query sẵn (không query thêm), chỉ đổi phần TRA CỨU config (giá kim loại/đá/tỷ lệ/VAT) sang bản
// mới nhất thay vì giá đã đóng băng lúc báo giá.
export interface LivePriceItem {
  key: string;
  materials: { materialId: string; weightChi: number }[];
  laborCost: number;
  vatRate: number;
  // Có `stones` (đá chọn từ danh mục) thì lấy giá đá HIỆN TẠI; không có thì dùng thẳng
  // manualStoneCost (đá nhập tay, không có nguồn nào để tra giá "sống").
  stones?: { stoneId: string; quantity: number }[];
  manualStoneCost?: number;
}

@Injectable()
export class QuoteOptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metalPricesService: MetalPricesService,
    private readonly materialsService: MaterialsService,
    private readonly pricingFormulasService: PricingFormulasService,
    private readonly stonesService: StonesService,
  ) {}

  // Tra 1 chất liệu theo tên — khớp CHÍNH XÁC với Material.name (đã @unique trong DB). Mọi nơi gọi
  // (CalculatorPage/PricingModal) đều chọn chất liệu qua <select> gắn materialId thật, materialName
  // gửi lên luôn là tên material có sẵn — không cần đoán/so khớp mờ qua regex như trước.
  private async resolveMaterial(materialNameOrKey: string): Promise<{
    material: ResolvedMaterial;
  } | null> {
    const normalizedMat = (materialNameOrKey || '').trim();
    if (!normalizedMat) return null;
    const materials = await this.materialsService.findAll();
    const matched = materials.find((m) => m.name === normalizedMat);
    if (!matched) return null;
    return { material: matched };
  }

  private async getDefaultStoneTiers(): Promise<MarginTier[]> {
    const defaultFormula = await this.pricingFormulasService.getDefault();
    return ((defaultFormula.config as any)?.tiers || []) as MarginTier[];
  }

  // Giá/viên đá TẠI THỜI ĐIỂM báo giá — gọi 1 lần trước khi build nhiều option, tránh N+1 query.
  // Không snapshot thì xem lại đơn cũ sẽ ra giá đá SAI (giá hôm nay) dù QuoteOption.stonePrice đã
  // đóng băng đúng tổng tiền.
  async buildStonePriceMap(
    effectiveOptions: any[],
  ): Promise<Map<string, number>> {
    const stoneIds = [
      ...new Set(
        effectiveOptions.flatMap((opt) =>
          (opt.stones || []).map((s: any) => s.stoneId),
        ),
      ),
    ].filter(Boolean);
    if (stoneIds.length === 0) return new Map();
    const stones = await this.prisma.stone.findMany({
      where: { id: { in: stoneIds } },
      select: { id: true, price: true },
    });
    return new Map(stones.map((s) => [s.id, Number(s.price)]));
  }

  // Danh sách hệ số nhân Bạc để Sale chọn lúc báo giá — tra theo chất liệu Bạc thật trong DB,
  // không còn 1 mảng cấu hình global tách rời (đổi hệ số/thêm kim loại khác dùng hệ số nhân
  // chỉ cần sửa PricingFormula, không đụng hàm này)
  async getSilverMultipliers(): Promise<number[]> {
    const materials = await this.materialsService.findAll();
    const silverMaterial = materials.find(
      (m) => (m as any).baseMetal?.name === 'Bạc',
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
    const result = computeMetalQuote(
      (resolved.material as any).baseMetal?.name || 'kim loại',
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
    // Khớp CHÍNH XÁC theo tên (materialName luôn từ <select> thật, xem resolveMaterial) — resolve
    // 1 lần, dùng lại baseMetal của nó cho mọi nhánh bên dưới thay vì đoán lại qua regex.
    const requestedMaterial = requestedMatName
      ? allMaterials.find((m) => m.name === requestedMatName)
      : undefined;
    const requestedBaseMetal = (requestedMaterial as any)?.baseMetal as
      { id: string; name: string } | undefined;

    // Không tìm được material khớp NHƯNG có nhập tên (VD Sale gõ mô tả tự do, không phải chọn từ
    // danh mục) → coi là phi kim loại, y hệt hành vi cũ (metalType 'OTHER'). Không nhập gì cả thì
    // KHÔNG coi là phi kim loại — rơi xuống nhánh mặc định (kim loại isDefault=true) bên dưới.
    const isNonPrecious = !!requestedMatName && !requestedMaterial;
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

    // Vàng (hoặc yêu cầu chung chung không rõ kim loại, mặc định theo BaseMetal.isDefault=true)
    // — tính TRƯỚC để nhánh "kim loại khác Vàng" bên dưới biết baseMetal đang xét có PHẢI nhóm
    // Vàng không (isGoldFamily), tránh 2 nhánh xử lý trùng nhau.
    const defaultBaseMetal = allMaterials.find(
      (m) => (m as any).baseMetal?.isDefault,
    )?.baseMetal as { id: string; name: string } | undefined;
    const targetGoldBaseMetalId =
      requestedBaseMetal?.id || defaultBaseMetal?.id;
    const goldMaterials = allMaterials.filter(
      (m) => (m as any).baseMetalId === targetGoldBaseMetalId,
    );
    const isGoldReq =
      !!requestedMaterial && requestedBaseMetal?.id === targetGoldBaseMetalId;
    const isGoldFamily =
      requestedBaseMetal &&
      goldMaterials.some(
        (m) => (m as any).baseMetalId === requestedBaseMetal.id,
      );

    // Kim loại khác Vàng (Bạc/Bạch kim/kim loại mới thêm sau) — chỉ 1 phương án, không sinh nhiều
    // lựa chọn so sánh như Vàng.
    if (requestedMaterial && requestedBaseMetal && !isGoldFamily) {
      const resolved = { material: requestedMaterial };
      const result = computeMetalQuote(
        requestedBaseMetal.name,
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

    const allGenerated = goldMaterials.map((mat) => {
      const isSaleTarget =
        isGoldReq && reqLower.includes(mat.name.toLowerCase());
      const result = computeMetalQuote(
        (mat as any).baseMetal?.name || 'Vàng',
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
      const { material } = resolved;
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

      const baseMetalId = (material as any).baseMetalId as string | null;
      const spotPrice = getSpotPrice(baseMetalId, metalPrices);
      if (!spotPrice || spotPrice <= 0) {
        throw new BadRequestException(
          `Chưa cấu hình đơn giá ${(material as any).baseMetal?.name || item.materialName} (VNĐ/chỉ) trong Database.`,
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

  // Tính giá "sống" cho NHIỀU phương án cùng lúc (Quản Lý Sản Phẩm) — không lưu vào DB, không tốn
  // thêm câu query nào: giá kim loại/danh mục chất liệu/công thức mặc định/danh mục đá đều lấy
  // ĐÚNG 1 LẦN cho cả mảng (đã cache TTL sẵn ở service tương ứng), phần còn lại tính thuần trong
  // RAM. 1 phương án lỗi (thiếu material/formula/giá kim loại...) chỉ trả null cho riêng nó, không
  // làm hỏng cả mảng — FE fallback về giá đã báo (quotedPrice) khi gặp null.
  async batchComputeLivePrices(
    itemsInput: LivePriceItem[],
  ): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    if (itemsInput.length === 0) return result;

    const [metalPrices, materials, defaultStoneTiers, stones] =
      await Promise.all([
        this.metalPricesService.getLatestAsync(),
        this.materialsService.findAll(),
        this.getDefaultStoneTiers(),
        this.stonesService.findAll(),
      ]);
    const materialById = new Map(materials.map((m) => [m.id, m]));
    const stoneById = new Map(stones.map((s) => [s.id, s]));

    for (const item of itemsInput) {
      try {
        let stoneCost = 0;
        if (item.stones && item.stones.length > 0) {
          for (const sel of item.stones) {
            const stone = stoneById.get(sel.stoneId);
            if (!stone) throw new Error('stone not found');
            stoneCost += Number(stone.price) * Math.max(1, sel.quantity || 1);
          }
        } else {
          stoneCost = Math.max(0, item.manualStoneCost || 0);
        }

        const mats = item.materials.filter((m) => m.weightChi > 0);
        if (mats.length === 0) {
          result.set(item.key, null);
          continue;
        }

        if (mats.length === 1) {
          const material = materialById.get(mats[0].materialId);
          if (!material) {
            result.set(item.key, null);
            continue;
          }
          const baseMetalId = (material as any).baseMetalId as string | null;
          if (!baseMetalId) {
            result.set(item.key, null);
            continue;
          }
          const r = computeMetalQuote(
            (material as any).baseMetal?.name || 'kim loại',
            material,
            mats[0].weightChi,
            item.laborCost,
            stoneCost,
            item.vatRate,
            metalPrices,
            undefined,
            defaultStoneTiers,
          );
          result.set(item.key, r.quotedPrice);
          continue;
        }

        // Nhiều chất liệu trong 1 phương án — gộp giống calculateMulti: cộng giá vốn kim loại,
        // bắt buộc chung 1 công thức MARGIN_TIERS (MULTIPLIER/khác công thức không gộp được).
        let totalMetalCost = 0;
        let sharedFormula: any = null;
        let ok = true;
        for (const m of mats) {
          const material = materialById.get(m.materialId);
          if (!material) {
            ok = false;
            break;
          }
          const formula = (material as any).pricingFormula;
          if (!formula || formula.formulaType === 'MULTIPLIER') {
            ok = false;
            break;
          }
          if (sharedFormula === null) sharedFormula = formula;
          else if (sharedFormula.id !== formula.id) {
            ok = false;
            break;
          }
          const spotPrice = getSpotPrice(
            (material as any).baseMetalId,
            metalPrices,
          );
          if (!spotPrice) {
            ok = false;
            break;
          }
          const metalPricePerChi =
            spotPrice * normalizeAppliedRatio(Number(material.priceRatioPct));
          totalMetalCost += m.weightChi * metalPricePerChi;
        }
        if (!ok || !sharedFormula) {
          result.set(item.key, null);
          continue;
        }

        const totalProductionCost = totalMetalCost + item.laborCost;
        const tiers = (sharedFormula.config?.tiers || []) as MarginTier[];
        if (tiers.length === 0) {
          result.set(item.key, null);
          continue;
        }
        const sorted = [...tiers].sort((a, b) => a.maxCost - b.maxCost);
        const costWithVat = totalProductionCost * (1 + item.vatRate / 100);
        const matchedTier =
          sorted.find((t) => costWithVat <= t.maxCost) ||
          sorted[sorted.length - 1];
        const divisor = matchedTier.divisor;
        const raw = divisor > 0 ? costWithVat / divisor : costWithVat;
        const stoneResult = computeStoneSellPrice(
          stoneCost,
          item.vatRate,
          defaultStoneTiers,
        );
        result.set(item.key, roundToThousand(raw + stoneResult.stonePrice));
      } catch {
        result.set(item.key, null);
      }
    }

    return result;
  }
}
