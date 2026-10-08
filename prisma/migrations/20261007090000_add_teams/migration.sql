-- Thêm bảng teams (nhóm người dùng) + cột users.team_id.
-- Idempotent: chạy lại nhiều lần không lỗi. Người dùng hiện có không có team (không backfill).
-- Chạy với search_path đúng schema `qms` (OMS cũng có bảng `teams` ở schema khác).

CREATE TABLE IF NOT EXISTS "teams" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "teams_name_key" ON "teams"("name");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "team_id" TEXT;
CREATE INDEX IF NOT EXISTS "users_team_id_idx" ON "users"("team_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_team_id_fkey'
      AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_team_id_fkey" FOREIGN KEY ("team_id")
      REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
