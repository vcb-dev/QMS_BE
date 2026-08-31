import { Prisma } from '@prisma/client';
import { OPTION_DETAIL_INCLUDE } from '../utils/option-mapper.util';
import { QuoteOptionItemDto } from '../quote-requests/dto/quote-complete.dto';

// 1 phần tử Map trả về của QuoteOptionsService.batchComputeLivePrices.
export interface LivePriceEntry {
  total: number;
  material: number;
  stone: number;
}

// QuoteOption sau khi include materials + stones (OPTION_DETAIL_INCLUDE) + các field
// runtime do app tự gắn sau khi query (không có trong DB).
export type HydratedOption = Prisma.QuoteOptionGetPayload<{
  include: typeof OPTION_DETAIL_INCLUDE;
}> & {
  priceBreakdown?: { material: number; stone: number };
  livePrice?: number | null;
  liveStonePrice?: number | null;
  livePriceBreakdown?: { material: number; stone: number };
  costBreakdown?: unknown;
  // Field FE-only đôi khi còn sót khi map (materialName gắn ở mapOptionDetail).
  materialName?: string;
};

export type OptionInput = Partial<QuoteOptionItemDto> & {
  optionName?: string;
  materialName?: string;
  isSelected?: boolean;
  materials?: { materialId: string; weightChi?: number | null }[];
  stones?: { stoneId: string; quantity: number }[];
  weightChi?: number | null;
};

