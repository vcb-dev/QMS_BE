-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SALE', 'PRICING', 'ADMIN');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('YC_MOI', 'DANG_XLY', 'XONG', 'TU_CHOI', 'NEED_MORE_INFO');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "province" TEXT NOT NULL,
    "ward" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'YC_MOI',
    "requesterId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "desiredDate" TIMESTAMP(3),
    "productName" TEXT NOT NULL,
    "desired_lead_time" TEXT,
    "materialId" TEXT,
    "categoryId" TEXT NOT NULL,
    "customerMeasurements" TEXT,
    "closeRatePct" DECIMAL(5,2),
    "vat" DECIMAL(5,2),
    "quotedPrice" DECIMAL(14,2),
    "quotedDate" TIMESTAMP(3),
    "pricerId" TEXT,
    "rejectReason" TEXT,
    "return_reason" TEXT,
    "selected_option_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_request_materials" (
    "id" TEXT NOT NULL,
    "quote_request_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_request_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_request_images" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_request_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metal_prices" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "gold_24k_vnd" DECIMAL(14,2) NOT NULL,
    "silver_vnd" DECIMAL(14,2) NOT NULL,
    "platinum_vnd" DECIMAL(14,2) NOT NULL,
    "source" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metal_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "gold_ratios" JSONB NOT NULL,
    "profit_margins" JSONB NOT NULL,
    "silver_multiplier" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_options" (
    "id" TEXT NOT NULL,
    "quote_request_id" TEXT NOT NULL,
    "option_name" TEXT NOT NULL,
    "material_name" TEXT,
    "weight_chi" DECIMAL(8,3),
    "labor_cost" DECIMAL(14,2),
    "stone_cost" DECIMAL(14,2),
    "stone_description" TEXT,
    "vat" DECIMAL(5,2),
    "quoted_price" DECIMAL(14,2) NOT NULL,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_departmentId_idx" ON "users"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "materials_name_key" ON "materials"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_name_key" ON "product_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_code_key" ON "quote_requests"("code");

-- CreateIndex
CREATE INDEX "quote_requests_status_createdAt_idx" ON "quote_requests"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "quote_requests_requesterId_idx" ON "quote_requests"("requesterId");

-- CreateIndex
CREATE INDEX "quote_requests_requesterId_status_idx" ON "quote_requests"("requesterId", "status");

-- CreateIndex
CREATE INDEX "quote_requests_pricerId_idx" ON "quote_requests"("pricerId");

-- CreateIndex
CREATE INDEX "quote_requests_pricerId_status_idx" ON "quote_requests"("pricerId", "status");

-- CreateIndex
CREATE INDEX "quote_requests_customerId_idx" ON "quote_requests"("customerId");

-- CreateIndex
CREATE INDEX "quote_requests_categoryId_idx" ON "quote_requests"("categoryId");

-- CreateIndex
CREATE INDEX "quote_requests_materialId_idx" ON "quote_requests"("materialId");

-- CreateIndex
CREATE INDEX "quote_requests_selected_option_id_idx" ON "quote_requests"("selected_option_id");

-- CreateIndex
CREATE INDEX "quote_request_materials_material_id_idx" ON "quote_request_materials"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_request_materials_quote_request_id_material_id_key" ON "quote_request_materials"("quote_request_id", "material_id");

-- CreateIndex
CREATE INDEX "quote_request_images_quoteRequestId_idx" ON "quote_request_images"("quoteRequestId");

-- CreateIndex
CREATE INDEX "quote_options_quote_request_id_idx" ON "quote_options"("quote_request_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_pricerId_fkey" FOREIGN KEY ("pricerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_materials" ADD CONSTRAINT "quote_request_materials_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_materials" ADD CONSTRAINT "quote_request_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_images" ADD CONSTRAINT "quote_request_images_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
