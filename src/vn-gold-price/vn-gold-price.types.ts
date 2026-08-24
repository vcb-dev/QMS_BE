export interface VnGoldPriceItem {
  key: string;
  label: string;
  priceVnd: number; // đ/chỉ
  changeAmount: number | null;
  changePct: number | null;
}

export interface VangTodaySource {
  code: string; // data-code trên vang.today
  label: string;
}
