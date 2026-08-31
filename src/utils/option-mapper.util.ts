// Chi tiết material/stone của 1 QuoteOption chỉ sống ở QuoteOptionMaterial/QuoteOptionStone
// (structured) — không còn lưu sẵn text tóm tắt. Include + map ở đây, dùng chung cho mọi service
// trả QuoteOption/QuoteRequest ra ngoài, để tránh mỗi service tự viết include khác nhau.

import { OptionSelectionStatus } from '@prisma/client';
import { LivePriceItem } from '../quote-requests/dto/calculate-price.dto';
import type {
  HydratedOption,
  LivePriceEntry,
  OptionInput,
} from '../common/quote.types';

export const OPTION_DETAIL_INCLUDE = {
  materials: { include: { material: true } },
  stones: { include: { stone: true } },
} as const;

export const REQUEST_DETAIL_INCLUDE = {
  customer: true,
  category: true,
  requester: {
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      larkOpenId: true,
    },
  },
  assignee: { select: { id: true, name: true, email: true } },
  images: true,
  options: {
    orderBy: { createdAt: 'asc' as const },
    include: OPTION_DETAIL_INCLUDE,
  },
} as const;

// Select rút gọn cho 1 QuoteOption khi liệt kê nhiều request (findAll) — đủ dữ liệu để tính
// productName/livePrice mà không kéo nguyên OPTION_DETAIL_INCLUDE (nặng hơn, dùng cho trang chi tiết).
export const OPTION_SUMMARY_SELECT = {
  id: true,
  optionName: true,
  quotedPrice: true,
  vat: true,
  quotedDate: true,
  weightChi: true,
  laborCost: true,
  stoneCost: true,
  totalMetalCost: true,
  metalRawCost: true,
  stonePrice: true,
  selectionStatus: true,
  materials: {
    select: {
      materialId: true,
      weightChi: true,
      material: { select: { id: true, name: true } },
    },
  },
  stones: {
    select: {
      stoneId: true,
      quantity: true,
      unitPriceAtQuote: true,
      stone: { select: { id: true, name: true, stoneType: true } },
    },
  },
} as const;

// Tên chất liệu trong DB nhúng sẵn tỉ lệ vàng (VD: "Vàng 14K (58.5%)") để hiển thị ở dropdown chọn
// chất liệu — nhưng ghép vào productName tự sinh thì thừa/rối, nên cắt phần "(xx.x%)" ra ở đây.
export function stripMaterialPercent(name: string): string {
  return name.replace(/\s*\(\d+(\.\d+)?%\)/g, '').trim();
}

// Tên sản phẩm tự sinh dùng chung cho findAll/findOne — "<Danh mục> <chất liệu, chất liệu>",
// fallback "Sản phẩm chế tác" nếu thiếu cả 2 (request không có category/material nào có giá).
export function buildProductName(
  categoryName: string | undefined,
  materialNames: string[],
): string {
  const matName = materialNames.map(stripMaterialPercent).join(', ');
  return `${categoryName || ''} ${matName}`.trim() || 'Sản phẩm chế tác';
}

// Tên sản phẩm cho Thư Viện Sản Phẩm (gộp thô theo danh mục + kim loại gốc) — ghép thẳng 3 khóa
// nhóm: "<Danh mục> <tên kim loại gốc> <tên đá, ...>". Không nêu tuổi vàng/khối lượng vì nhóm gộp
// mọi biến thể đó. Chỉ có phần đá khi nhóm có đá cấu trúc (tách đá).
export function buildLibraryProductName(
  categoryName: string | undefined,
  baseMetalName: string | undefined,
  stoneNames: string[],
): string {
  const stones = stoneNames.filter(Boolean).join(', ');
  return (
    [categoryName || '', baseMetalName || '', stones]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Sản phẩm chế tác'
  );
}

// Khóa gộp nhóm THÔ cho Thư Viện Sản Phẩm — nguồn sự thật DUY NHẤT, dùng chung cho:
//   - write path (buildOptionCreateInput) ghi vào QuoteOption.libraryGroupKey
//   - script backfill row cũ
//   - (thay cho hàm libraryGroupKey() tính-lúc-đọc cũ trong quote-query.service.ts)
// Format: "<categoryId> | <baseMetalId của chất liệu NẶNG NHẤT có kim loại gốc> | <tập tên đá
// MAIN đã lowercase + distinct + sort, nối '~'>". Chất liệu phi kim loại (baseMetalId null),
// tuổi vàng, khối lượng, size/giác cắt/số lượng đá, đá SIDE — KHÔNG vào khóa.
export function computeLibraryGroupKey(
  opt: { materials?: any[]; stones?: any[]; weightChi?: unknown },
  categoryId: string | undefined,
  materialBaseMetal: Map<string, string | null | undefined>,
  stoneMeta: Map<string, { name?: string | null; stoneType?: string | null }>,
): string {
  const mats = (opt.materials || [])
    .map((m: any) => ({
      baseMetalId: materialBaseMetal.get(m.materialId) ?? null,
      weightChi: Number(m.weightChi ?? opt.weightChi ?? 0) || 0,
    }))
    .filter((m) => !!m.baseMetalId);
  mats.sort((a, b) => b.weightChi - a.weightChi);
  const baseMetalId = mats[0]?.baseMetalId || 'none';

  const stoneKey = [
    ...new Set(
      (opt.stones || [])
        .map((s: any) => stoneMeta.get(s.stoneId))
        .filter(
          (m): m is { name: string; stoneType: string } =>
            !!m && m.stoneType === 'MAIN' && !!m.name,
        )
        .map((m) => String(m.name).trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
    .sort()
    .join('~');

  return `${categoryId || ''}|${baseMetalId}|${stoneKey}`;
}

// Build nested-create payload cho 1 QuoteOption từ QuoteOptionItemDto — dùng ở mọi chỗ
// tạo/ghi-đè option (create request, quick-quote, complete quote, quick-approve).
export function buildOptionCreateInput(
  opt: OptionInput,
  idx: number,
  categoryId?: string,
  stonePriceMap?: Map<string, number>,
  keyMaps?: {
    materialBaseMetal: Map<string, string | null | undefined>;
    stoneMeta: Map<string, { name?: string | null; stoneType?: string | null }>;
  },
) {
  const matKey =
    opt.materials && opt.materials.length > 0
      ? opt.materials
          .map(
            (m) =>
              `${m.materialId}:${m.weightChi != null ? m.weightChi : opt.weightChi || 0}`,
          )
          .sort()
          .join(',')
      : `${opt.materialName || ''}:${opt.weightChi || 0}`;
  const stoneKey =
    opt.stones && opt.stones.length > 0
      ? opt.stones
          .map((s) => `${s.stoneId}:${s.quantity}`)
          .sort()
          .join(',')
      : opt.stoneDescription ||
        (opt.stoneCost ? `cost:${opt.stoneCost}` : 'none');
  const dedupKey = `${categoryId || ''}|${matKey}|${stoneKey}`;
  // Khóa gộp nhóm Thư Viện — chỉ tính khi caller cấp keyMaps (luồng ghi option). Thiếu keyMaps
  // (test cũ, hoặc caller chưa cập nhật) thì để undefined, row đó chờ script backfill.
  const libraryGroupKey = keyMaps
    ? computeLibraryGroupKey(
        opt,
        categoryId,
        keyMaps.materialBaseMetal,
        keyMaps.stoneMeta,
      )
    : undefined;

  return {
    optionName: opt.optionName || `Phương án ${idx + 1}`,
    weightChi: opt.weightChi,
    laborCost: opt.laborCost,
    stoneCost: opt.stoneCost,
    totalMetalCost: opt.totalMetalCost,
    metalRawCost: opt.metalRawCost,
    stonePrice: opt.stonePrice,
    vat: opt.vat,
    quotedPrice: opt.quotedPrice,
    // Có giá = vừa báo giá thật; option nháp (chưa có giá) thì chưa có mốc báo giá
    quotedDate: opt.quotedPrice != null ? new Date() : undefined,
    note: opt.note,
    stoneDescription: opt.stoneDescription,
    dedupKey,
    libraryGroupKey,
    // FE đánh dấu phương án nào là giá chính (radio) — ghi thẳng vào selectionStatus, nguồn sự
    // thật duy nhất cho "phương án nào đang dùng để báo giá" (thay QuoteRequest.selectedOptionId cũ).
    selectionStatus: opt.isSelected
      ? OptionSelectionStatus.SELECTED
      : OptionSelectionStatus.NONE,
    materials: opt.materials?.length
      ? {
          create: opt.materials.map((m: any) => ({
            materialId: m.materialId,
            weightChi: m.weightChi != null ? m.weightChi : opt.weightChi,
          })),
        }
      : undefined,
    stones: opt.stones?.length
      ? {
          create: opt.stones.map((s: any) => ({
            stoneId: s.stoneId,
            quantity: s.quantity,
            unitPriceAtQuote: stonePriceMap?.get(s.stoneId),
          })),
        }
      : undefined,
  };
}

// Hai thành phần giá BÁN hiển thị của 1 option. `material` lấy bằng hiệu (quotedPrice - stonePrice)
// — KHÔNG dùng thẳng totalMetalCost — để 2 dòng phụ trên UI luôn cộng đúng bằng con số tổng đang
// hiển thị. null khi option chưa có giá; stone = 0 khi không đính đá.
export function computePriceBreakdown(
  quotedPrice: unknown,
  stonePrice: unknown,
): { material: number; stone: number } | null {
  if (quotedPrice === null || quotedPrice === undefined) return null;
  const total = Number(quotedPrice);
  if (!Number.isFinite(total)) return null;
  const stone = Number(stonePrice) || 0;
  return { material: Math.round(total - stone), stone: Math.round(stone) };
}

// Bản GIÁ SỐNG (tính lại hôm nay) của computePriceBreakdown — tách 2 dòng phụ material/stone từ
// livePrice + liveStonePrice. null khi thiếu 1 trong 2 (chưa tính được giá sống). Dùng chung ở mọi
// chỗ gắn livePriceBreakdown cho 1 option (attachPriceBreakdowns / buildHistoryEntry).
export function computeLivePriceBreakdown(
  livePrice: unknown,
  liveStonePrice: unknown,
): { material: number; stone: number } | null {
  if (livePrice == null || liveStonePrice == null) return null;
  const total = Number(livePrice);
  const stone = Number(liveStonePrice);
  if (!Number.isFinite(total) || !Number.isFinite(stone)) return null;
  return { material: Math.round(total - stone), stone: Math.round(stone) };
}

// Cấu thành lãi/VAT của 1 QuoteOption ĐÃ LƯU — suy từ các cột đóng băng lúc báo giá
// (metalRawCost/laborCost/totalMetalCost/stoneCost/stonePrice/vat), KHÔNG tính lại công thức.
// Khớp đúng nghĩa với luồng máy tính giá (computeMetalQuote/computeStoneSellPrice):
//   metalVatAmount  = (giá vốn kim loại thô + công) × vat%
//   metalProfit     = giá bán kim loại (totalMetalCost, = raw trước làm tròn) − (vốn+công) có VAT
//   stoneVatAmount  = tiền đá gốc × vat%
//   stoneProfit     = giá bán đá (stonePrice) − tiền đá gốc có VAT
// null khi thiếu cột bắt buộc (option nháp chưa có giá, hoặc record cũ chưa lưu đủ).
// Đây là DỮ LIỆU GIÁ VỐN — QuoteQueryService.stripCostFieldsForSale phải cắt field này cho SALE.
export function computeCostBreakdown(opt: {
  metalRawCost?: unknown;
  laborCost?: unknown;
  totalMetalCost?: unknown;
  stoneCost?: unknown;
  stonePrice?: unknown;
  vat?: unknown;
}): {
  metalVatAmount: number;
  metalProfit: number;
  stoneVatAmount: number;
  stoneProfit: number;
} | null {
  const metalRaw = Number(opt.metalRawCost);
  const metalSell = Number(opt.totalMetalCost);
  if (!Number.isFinite(metalRaw) || !Number.isFinite(metalSell)) return null;

  const labor = Number(opt.laborCost) || 0;
  const stoneCost = Number(opt.stoneCost) || 0;
  const stoneSell = Number(opt.stonePrice) || 0;
  const vat = Number(opt.vat) || 0;

  const metalProdCost = metalRaw + labor;
  const metalCostWithVat = metalProdCost * (1 + vat / 100);
  const stoneCostWithVat = stoneCost * (1 + vat / 100);

  return {
    metalVatAmount: Math.round(metalCostWithVat - metalProdCost),
    metalProfit: Math.round(metalSell - metalCostWithVat),
    stoneVatAmount: Math.round(stoneCostWithVat - stoneCost),
    stoneProfit: Math.round(stoneSell - stoneCostWithVat),
  };
}

// Mutate 1 QuoteOption đã hydrate: gắn priceBreakdown (+ livePriceBreakdown nếu đã có live +
// costBreakdown giá vốn). Dùng chung cho QuoteQueryService (danh sách) và LibraryService (Thư Viện).
export function attachPriceBreakdowns(opt: HydratedOption) {
  const bd = computePriceBreakdown(opt.quotedPrice, opt.stonePrice);
  if (bd) opt.priceBreakdown = bd;
  const liveBd = computeLivePriceBreakdown(opt.livePrice, opt.liveStonePrice);
  if (liveBd) opt.livePriceBreakdown = liveBd;
  const costBd = computeCostBreakdown(opt);
  if (costBd) opt.costBreakdown = costBd;
  return opt;
}

// 1 QuoteOption đã hydrate -> input cho QuoteOptionsService.batchComputeLivePrices. categoryVat !=
// null (danh sách yêu cầu — VAT theo danh mục) đè lên opt.vat; null (Thư Viện) dùng VAT đóng trên
// chính option. THUẦN — không DI, dùng chung cho mọi service tính giá sống.
export function toLivePriceInput(
  opt: HydratedOption,
  categoryVat: number | null = null,
): LivePriceItem {
  return {
    key: opt.id,
    materials: (opt.materials || []).map((m) => ({
      materialId: m.materialId,
      weightChi: Number(m.weightChi) || 0,
    })),
    laborCost: Number(opt.laborCost) || 0,
    vatRate: categoryVat ?? (opt.vat != null ? Number(opt.vat) : 10),
    stones:
      (opt.stones || []).length > 0
        ? opt.stones.map((s) => ({
            stoneId: s.stoneId,
            quantity: s.quantity,
          }))
        : undefined,
    manualStoneCost: Number(opt.stoneCost) || 0,
  };
}

// Gắn livePrice/liveStonePrice từ kết quả batchComputeLivePrices vào từng option (null = không tính
// được, giữ nguyên liveStonePrice cũ nếu có).
export function applyLivePriceMap(
  options: {
    id: string;
    livePrice?: number | null;
    liveStonePrice?: number | null;
  }[],
  priceMap: Map<string, LivePriceEntry | null>,
) {
  for (const opt of options) {
    const entry = priceMap.get(opt.id);
    if (entry === undefined) continue;
    opt.livePrice = entry === null ? null : entry.total;
    if (entry) opt.liveStonePrice = entry.stone;
  }
}

// Nhận cả QuoteOption hydrate thô (HydratedOption) lẫn object option đã map dở (test / luồng cũ) —
// hàm chỉ đọc quotedPrice/stonePrice/materials/stones + spread phần còn lại, nên khai lỏng thay vì
// ép full Prisma payload.
type MappableOption = {
  quotedPrice?: unknown;
  stonePrice?: unknown;
  materials?: any[];
  stones?: any[];
  [k: string]: unknown;
};

export function mapOptionDetail(opt: MappableOption) {
  if (!opt) return opt;
  const priceBreakdown = computePriceBreakdown(opt.quotedPrice, opt.stonePrice);
  const costBreakdown = computeCostBreakdown(opt);
  return {
    ...opt,
    ...(priceBreakdown ? { priceBreakdown } : {}),
    ...(costBreakdown ? { costBreakdown } : {}),
    materials: Array.isArray(opt.materials)
      ? opt.materials.map((m) => ({
          materialId: m.materialId,
          // runtime shape: đã gắn materialName ở bước trước hoặc lấy từ relation material
          materialName: m.material?.name ?? (m as any).materialName,
          weightChi: m.weightChi,
        }))
      : opt.materials,
    stones: Array.isArray(opt.stones)
      ? opt.stones.map((s) => ({
          stoneId: s.stoneId,
          stoneName: s.stone?.name,
          stoneType: s.stone?.stoneType,
          quantity: s.quantity,
          // Ưu tiên giá đã đóng băng lúc báo giá; record cũ (trước khi có field này) fallback giá hiện tại
          price:
            s.unitPriceAtQuote != null
              ? Number(s.unitPriceAtQuote)
              : s.stone?.price,
        }))
      : opt.stones,
  };
}

// quote: kết quả query QuoteRequest + REQUEST_DETAIL_INCLUDE. Giữ `any` có chủ đích — type chặt
// (Prisma.QuoteRequestGetPayload) làm vỡ ~15 chỗ ở read path pricing/workflow do các nơi đó
// reshape kết quả loosely (spec R1.3 cho phép giữ any khi gỡ hết quá tốn).
export function mapQuoteRequestDetail(quote: any) {
  if (!quote) return quote;
  return {
    ...quote,
    // Bản ghi cũ có thể lưu nguyên chuỗi base64 (data:...) thay vì link Cloudinary — lọc bỏ khỏi
    // MỌI response chi tiết (findOne + các action ở quote-workflow.service). findAll/export lọc
    // riêng ở sanitizeItem; đây phủ nốt phần còn lại.
    images: Array.isArray(quote.images)
      ? quote.images.filter(
          (img: any) => !String(img?.imageUrl || '').startsWith('data:'),
        )
      : quote.images,
    options: Array.isArray(quote.options)
      ? quote.options.map(mapOptionDetail)
      : quote.options,
  };
}

// Phương án "đại diện" của 1 request khi cần 1 con số duy nhất (mail, thống kê nhanh, hiển thị
// tổng giá chốt): ưu tiên option đã CLOSED (khách chốt), rồi tới option đang SELECTED (chọn báo
// giá chính), rồi tới option có GIÁ MỚI NHẤT (options orderBy createdAt asc) — không được lấy
// options[0] vô điều kiện, vì option đầu tiên luôn là bản nháp rỗng "Yêu cầu ban đầu" tự tạo lúc
// Sale gửi yêu cầu, chưa có giá.
export function pickPrimaryOption<T = any>(
  quote: { options?: T[] } | null | undefined,
): T | null {
  const options = Array.isArray(quote?.options) ? quote.options : [];
  if (options.length === 0) return null;
  const closed = options.find((o: any) => o?.selectionStatus === 'CLOSED');
  if (closed) return closed;
  const selected = options.find((o: any) => o?.selectionStatus === 'SELECTED');
  if (selected) return selected;
  const priced = options.filter((o: any) => o?.quotedPrice != null);
  if (priced.length > 0) return priced[priced.length - 1];
  return options[0];
}

// Rút gọn kết quả pickPrimaryOption thành 2 giá trị cần denormalize xuống QuoteRequest —
// dùng bởi syncFinalOption() trong quote-workflow.service.ts, tách riêng để test thuần không cần
// mock Prisma.
export function computeFinalOption(
  options: { id: string; quotedPrice: any; selectionStatus: string }[],
): { finalOptionId: string | null; finalPrice: any } {
  const primary = pickPrimaryOption({ options });
  return {
    finalOptionId: primary?.id ?? null,
    finalPrice: primary?.quotedPrice ?? null,
  };
}
