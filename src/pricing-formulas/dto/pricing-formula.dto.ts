export class MarginTier {
  maxCost: number;
  divisor: number;
  margin: string;
}

// MARGIN_TIERS dùng `tiers`, MULTIPLIER dùng `multipliers` — 1 formula chỉ có đúng 1 trong 2
export class PricingFormulaConfig {
  tiers?: MarginTier[];
  multipliers?: number[];
}

export class PricingFormulaDto {
  id: string;
  name: string;
  formulaType: 'MARGIN_TIERS' | 'MULTIPLIER';
  config: PricingFormulaConfig;
  isDefault: boolean;
  updatedAt: string;
}
