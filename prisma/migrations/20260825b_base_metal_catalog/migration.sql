-- BaseMetal — danh mục kim loại gốc, thay 3 cột cứng gold24kVnd/silverVnd/platinumVnd của
-- metal_prices. Chưa xóa bảng metal_prices (giữ archive) — xem migration khác nếu cần dọn sau.
CREATE TABLE IF NOT EXISTS "base_metals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "base_metals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "base_metals_name_key" ON "base_metals"("name");

CREATE TABLE IF NOT EXISTS "base_metal_price_history" (
    "id" TEXT NOT NULL,
    "base_metal_id" TEXT NOT NULL,
    "priceVnd" DECIMAL(14,2) NOT NULL,
    "changePct" DECIMAL(6,2),
    "source" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "base_metal_price_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "base_metal_price_history_base_metal_id_isActive_idx" ON "base_metal_price_history"("base_metal_id", "isActive");
CREATE INDEX IF NOT EXISTS "base_metal_price_history_created_at_idx" ON "base_metal_price_history"("created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'base_metal_price_history_base_metal_id_fkey') THEN
    ALTER TABLE "base_metal_price_history"
      ADD CONSTRAINT "base_metal_price_history_base_metal_id_fkey"
      FOREIGN KEY ("base_metal_id") REFERENCES "base_metals"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'base_metal_price_history_updated_by_id_fkey') THEN
    ALTER TABLE "base_metal_price_history"
      ADD CONSTRAINT "base_metal_price_history_updated_by_id_fkey"
      FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "base_metal_id" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_base_metal_id_fkey') THEN
    ALTER TABLE "materials"
      ADD CONSTRAINT "materials_base_metal_id_fkey"
      FOREIGN KEY ("base_metal_id") REFERENCES "base_metals"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
