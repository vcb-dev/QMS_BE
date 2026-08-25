export class BaseMetalDto {
  id: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  priceVnd: number; // giá đang active — 0 nếu chưa từng có giá
  changePct: number | null;
  updatedAt: string | null; // null nếu chưa từng có giá
  updatedByName: string | null;
}

export class BaseMetalPriceHistoryItem {
  id: string;
  baseMetalId: string;
  baseMetalName: string;
  priceVnd: number;
  changePct: number | null;
  isActive: boolean;
  updatedById: string | null;
  updatedByName: string | null;
  createdAt: string;
  source: string | null;
}
