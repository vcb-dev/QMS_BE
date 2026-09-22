/*
  Warnings:

  - You are about to drop the column `department_id` on the `users` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_department_id_fkey";

-- DropIndex
DROP INDEX "users_department_id_idx";

-- AlterTable
ALTER TABLE "quote_requests" ADD COLUMN     "department_id" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "department_id";

-- CreateIndex
CREATE INDEX "quote_requests_department_id_idx" ON "quote_requests"("department_id");

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
