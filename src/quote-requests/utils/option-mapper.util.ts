// Chi tiết material/stone của 1 QuoteOption chỉ sống ở QuoteOptionMaterial/QuoteOptionStone
// (structured) — không còn lưu sẵn text tóm tắt. Include + map ở đây, dùng chung cho mọi service
// trả QuoteOption/QuoteRequest ra ngoài, để tránh mỗi service tự viết include khác nhau.

import { OptionSelectionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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

// Giá/viên đá TẠI THỜI ĐIỂM báo giá — gọi 1 lần trước khi build nhiều option, tránh N+1 query.
// Không snapshot thì xem lại đơn cũ sẽ ra giá đá SAI (giá hôm nay) dù QuoteOption.stonePrice đã
// đóng băng đúng tổng tiền.
export async function buildStonePriceMap(
  prisma: PrismaService,
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
  const stones = await prisma.stone.findMany({
    where: { id: { in: stoneIds } },
    select: { id: true, price: true },
  });
  return new Map(stones.map((s) => [s.id, Number(s.price)]));
}

// Build nested-create payload cho 1 QuoteOption từ QuoteOptionItemDto — dùng ở mọi chỗ
// tạo/ghi-đè option (create request, quick-quote, complete quote, quick-approve).
export function buildOptionCreateInput(
  opt: any,
  idx: number,
  stonePriceMap?: Map<string, number>,
) {
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
