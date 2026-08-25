// Chi tiết material/stone của 1 QuoteOption chỉ sống ở QuoteOptionMaterial/QuoteOptionStone
// (structured) — không còn lưu sẵn text tóm tắt. Include + map ở đây, dùng chung cho mọi service
// trả QuoteOption/QuoteRequest ra ngoài, để tránh mỗi service tự viết include khác nhau.

import { OptionSelectionStatus } from '@prisma/client';

export const OPTION_DETAIL_INCLUDE = {
  materials: { include: { material: true } },
  stones: { include: { stone: true } },
} as const;

export const REQUEST_DETAIL_INCLUDE = {
  customer: true,
  category: true,
  requester: {
    select: { id: true, name: true, email: true, department: true },
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

// Build nested-create payload cho 1 QuoteOption từ QuoteOptionItemDto — dùng ở mọi chỗ
// tạo/ghi-đè option (create request, quick-quote, complete quote, quick-approve).
export function buildOptionCreateInput(
  opt: any,
  idx: number,
  categoryId?: string,
  stonePriceMap?: Map<string, number>,
) {
  const matKey =
    opt.materials?.length > 0
      ? opt.materials
          .map(
            (m: any) =>
              `${m.materialId}:${m.weightChi != null ? m.weightChi : opt.weightChi || 0}`,
          )
          .sort()
          .join(',')
      : `${opt.materialName || ''}:${opt.weightChi || 0}`;
  const stoneKey =
    opt.stones?.length > 0
      ? opt.stones
          .map((s: any) => `${s.stoneId}:${s.quantity}`)
          .sort()
          .join(',')
      : opt.stoneDescription ||
        (opt.stoneCost ? `cost:${opt.stoneCost}` : 'none');
  const dedupKey = `${categoryId || ''}|${matKey}|${stoneKey}`;

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

export function mapOptionDetail(opt: any) {
  if (!opt) return opt;
  return {
    ...opt,
    materials: Array.isArray(opt.materials)
      ? opt.materials.map((m: any) => ({
          materialId: m.materialId,
          materialName: m.material?.name,
          weightChi: m.weightChi,
        }))
      : opt.materials,
    stones: Array.isArray(opt.stones)
      ? opt.stones.map((s: any) => ({
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

export function mapQuoteRequestDetail(quote: any) {
  if (!quote) return quote;
  return {
    ...quote,
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
export function pickPrimaryOption(quote: any) {
  const options = Array.isArray(quote?.options) ? quote.options : [];
  if (options.length === 0) return null;
  const closed = options.find((o: any) => o.selectionStatus === 'CLOSED');
  if (closed) return closed;
  const selected = options.find((o: any) => o.selectionStatus === 'SELECTED');
  if (selected) return selected;
  const priced = options.filter((o: any) => o.quotedPrice != null);
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
