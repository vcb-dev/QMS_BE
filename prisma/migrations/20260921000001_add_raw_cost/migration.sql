ALTER TABLE "quote_options" ADD COLUMN IF NOT EXISTS "metal_raw_cost" DECIMAL(14,2);
ALTER TABLE "quote_option_materials" ADD COLUMN IF NOT EXISTS "raw_cost" DECIMAL(14,2);
