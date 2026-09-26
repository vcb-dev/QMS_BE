ALTER TABLE "quote_option_stones" ADD COLUMN IF NOT EXISTS "parent_stone_id" TEXT REFERENCES "quote_option_stones"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "quote_option_stones_parent_stone_id_idx" ON "quote_option_stones"("parent_stone_id");
