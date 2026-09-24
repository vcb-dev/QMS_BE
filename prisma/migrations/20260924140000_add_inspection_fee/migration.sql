ALTER TABLE "quote_requests" ADD COLUMN IF NOT EXISTS "inspection_fee" DECIMAL(14,2) DEFAULT 0;
