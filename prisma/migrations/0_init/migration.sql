-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SALE', 'ORDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'PROCESSING', 'QUOTED', 'REJECTED', 'NEED_MORE_INFO', 'CLOSED');

-- CreateEnum
CREATE TYPE "StoneType" AS ENUM ('MAIN', 'SIDE');

-- CreateEnum
CREATE TYPE "OptionSelectionStatus" AS ENUM ('NONE', 'SELECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PricingFormulaType" AS ENUM ('MARGIN_TIERS', 'MULTIPLIER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "lark_open_id" TEXT,
    "avatar" TEXT,
    "refresh_token_hash" TEXT,
    "reset_token_hash" TEXT,
    "reset_token_expires" TIMESTAMP(3),
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "role" "Role" NOT NULL,
    "department_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_metals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_metals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_metal_price_history" (
    "id" TEXT NOT NULL,
    "base_metal_id" TEXT NOT NULL,
    "price_vnd" DECIMAL(14,2) NOT NULL,
    "change_pct" DECIMAL(6,2),
    "source" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_metal_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "base_metal_id" TEXT,
    "price_ratio_pct" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "pricing_formula_id" TEXT NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_formulas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formula_type" "PricingFormulaType" NOT NULL,
    "config" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_formulas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "labor_cost" DECIMAL(14,2),
    "vat_rate" DECIMAL(5,2),

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provinces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "province_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "province_id" TEXT,
    "ward_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "requester_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "desired_date" TIMESTAMP(3),
    "desired_lead_time" TEXT,
    "category_id" TEXT NOT NULL,
    "customer_measurements" TEXT,
    "note" TEXT,
    "close_rate_pct" DECIMAL(5,2),
    "assignee_id" TEXT,
    "reject_reason" TEXT,
    "return_reason" TEXT,
    "accepted_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "video_url" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "final_option_id" TEXT,
    "final_price" DECIMAL(14,2),

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stones" (
    "id" TEXT NOT NULL,
    "stone_type" "StoneType" NOT NULL,
    "name" TEXT NOT NULL,
    "cut" TEXT,
    "size" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_request_images" (
    "id" TEXT NOT NULL,
    "quote_request_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_request_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_options" (
    "id" TEXT NOT NULL,
    "quote_request_id" TEXT NOT NULL,
    "option_name" TEXT NOT NULL,
    "weight_chi" DECIMAL(8,3),
    "labor_cost" DECIMAL(14,2),
    "stone_cost" DECIMAL(14,2),
    "total_metal_cost" DECIMAL(14,2),
    "metal_raw_cost" DECIMAL(14,2),
    "stone_price" DECIMAL(14,2),
    "vat" DECIMAL(5,2),
    "quoted_price" DECIMAL(14,2),
    "quoted_date" TIMESTAMP(3),
    "note" TEXT,
    "stone_description" TEXT,
    "selection_status" "OptionSelectionStatus" NOT NULL DEFAULT 'NONE',
    "dedup_key" TEXT,
    "library_group_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_option_materials" (
    "id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "weight_chi" DECIMAL(8,3),
    "raw_cost" DECIMAL(14,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_option_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_option_stones" (
    "id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "stone_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_at_quote" DECIMAL(14,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_option_stones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_chat_messages" (
    "id" TEXT NOT NULL,
    "quote_request_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_chat_reads" (
    "quote_request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,
    "lark_anchor_msg_id" TEXT,
    "lark_pending_count" INTEGER NOT NULL DEFAULT 0,
    "lark_last_dm_at" TIMESTAMP(3),

    CONSTRAINT "quote_chat_reads_pkey" PRIMARY KEY ("quote_request_id","user_id")
);

-- CreateTable
CREATE TABLE "lark_webhook" (
    "id" TEXT NOT NULL,
    "chat_name" TEXT NOT NULL,
    "bot_name" TEXT,
    "webhook_url" TEXT NOT NULL,
    "webhook_secret" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_webhook_subscription" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_webhook_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lark_dm_bridge_config" (
    "id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL,
    "note" TEXT,
    "changed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lark_dm_bridge_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_lark_open_id_key" ON "users"("lark_open_id");

-- CreateIndex
CREATE INDEX "users_department_id_idx" ON "users"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "base_metals_name_key" ON "base_metals"("name");

-- CreateIndex
CREATE INDEX "base_metal_price_history_base_metal_id_is_active_idx" ON "base_metal_price_history"("base_metal_id", "is_active");

-- CreateIndex
CREATE INDEX "base_metal_price_history_created_at_idx" ON "base_metal_price_history"("created_at");

-- CreateIndex
CREATE INDEX "base_metal_price_history_updated_by_id_idx" ON "base_metal_price_history"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "materials_name_key" ON "materials"("name");

-- CreateIndex
CREATE INDEX "materials_pricing_formula_id_idx" ON "materials"("pricing_formula_id");

-- CreateIndex
CREATE INDEX "materials_base_metal_id_idx" ON "materials"("base_metal_id");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_formulas_name_key" ON "pricing_formulas"("name");

-- CreateIndex
CREATE INDEX "pricing_formulas_updated_by_id_idx" ON "pricing_formulas"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_name_key" ON "product_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "provinces_name_key" ON "provinces"("name");

-- CreateIndex
CREATE UNIQUE INDEX "provinces_code_key" ON "provinces"("code");

-- CreateIndex
CREATE INDEX "wards_province_id_idx" ON "wards"("province_id");

-- CreateIndex
CREATE INDEX "customers_province_id_idx" ON "customers"("province_id");

-- CreateIndex
CREATE INDEX "customers_ward_id_idx" ON "customers"("ward_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_code_key" ON "quote_requests"("code");

-- CreateIndex
CREATE INDEX "quote_requests_status_final_price_idx" ON "quote_requests"("status", "final_price");

-- CreateIndex
CREATE INDEX "quote_requests_status_created_at_idx" ON "quote_requests"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quote_requests_created_at_idx" ON "quote_requests"("created_at" DESC);

-- CreateIndex
CREATE INDEX "quote_requests_requester_id_created_at_idx" ON "quote_requests"("requester_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quote_requests_requester_id_status_idx" ON "quote_requests"("requester_id", "status");

-- CreateIndex
CREATE INDEX "quote_requests_assignee_id_created_at_idx" ON "quote_requests"("assignee_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quote_requests_assignee_id_status_idx" ON "quote_requests"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "quote_requests_customer_id_idx" ON "quote_requests"("customer_id");

-- CreateIndex
CREATE INDEX "quote_requests_category_id_idx" ON "quote_requests"("category_id");

-- CreateIndex
CREATE INDEX "stones_stone_type_name_idx" ON "stones"("stone_type", "name");

-- CreateIndex
CREATE INDEX "stones_is_active_name_idx" ON "stones"("is_active", "name");

-- CreateIndex
CREATE INDEX "quote_request_images_quote_request_id_idx" ON "quote_request_images"("quote_request_id");

-- CreateIndex
CREATE INDEX "quote_options_quote_request_id_idx" ON "quote_options"("quote_request_id");

-- CreateIndex
CREATE INDEX "quote_options_quote_request_id_created_at_idx" ON "quote_options"("quote_request_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_options_dedup_key_idx" ON "quote_options"("dedup_key");

-- CreateIndex
CREATE INDEX "quote_options_library_group_key_idx" ON "quote_options"("library_group_key");

-- CreateIndex
CREATE INDEX "quote_option_materials_material_id_idx" ON "quote_option_materials"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_option_materials_option_id_material_id_key" ON "quote_option_materials"("option_id", "material_id");

-- CreateIndex
CREATE INDEX "quote_option_stones_stone_id_idx" ON "quote_option_stones"("stone_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_option_stones_option_id_stone_id_key" ON "quote_option_stones"("option_id", "stone_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_role_action_idx" ON "audit_logs"("actor_role", "action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "quote_chat_messages_quote_request_id_created_at_idx" ON "quote_chat_messages"("quote_request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quote_chat_reads_lark_anchor_msg_id_key" ON "quote_chat_reads"("lark_anchor_msg_id");

-- CreateIndex
CREATE UNIQUE INDEX "lark_webhook_webhook_url_key" ON "lark_webhook"("webhook_url");

-- CreateIndex
CREATE UNIQUE INDEX "lark_webhook_webhook_secret_key" ON "lark_webhook"("webhook_secret");

-- CreateIndex
CREATE INDEX "lark_webhook_updated_by_id_idx" ON "lark_webhook"("updated_by_id");

-- CreateIndex
CREATE INDEX "lark_webhook_subscription_action_idx" ON "lark_webhook_subscription"("action");

-- CreateIndex
CREATE UNIQUE INDEX "lark_webhook_subscription_webhook_id_action_key" ON "lark_webhook_subscription"("webhook_id", "action");

-- CreateIndex
CREATE INDEX "lark_dm_bridge_config_created_at_idx" ON "lark_dm_bridge_config"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_metal_price_history" ADD CONSTRAINT "base_metal_price_history_base_metal_id_fkey" FOREIGN KEY ("base_metal_id") REFERENCES "base_metals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_metal_price_history" ADD CONSTRAINT "base_metal_price_history_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_base_metal_id_fkey" FOREIGN KEY ("base_metal_id") REFERENCES "base_metals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_pricing_formula_id_fkey" FOREIGN KEY ("pricing_formula_id") REFERENCES "pricing_formulas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_formulas" ADD CONSTRAINT "pricing_formulas_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_images" ADD CONSTRAINT "quote_request_images_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_options" ADD CONSTRAINT "quote_options_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_option_materials" ADD CONSTRAINT "quote_option_materials_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "quote_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_option_materials" ADD CONSTRAINT "quote_option_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_option_stones" ADD CONSTRAINT "quote_option_stones_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "quote_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_option_stones" ADD CONSTRAINT "quote_option_stones_stone_id_fkey" FOREIGN KEY ("stone_id") REFERENCES "stones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_chat_messages" ADD CONSTRAINT "quote_chat_messages_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_chat_messages" ADD CONSTRAINT "quote_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_chat_reads" ADD CONSTRAINT "quote_chat_reads_quote_request_id_fkey" FOREIGN KEY ("quote_request_id") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_chat_reads" ADD CONSTRAINT "quote_chat_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lark_webhook" ADD CONSTRAINT "lark_webhook_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lark_webhook_subscription" ADD CONSTRAINT "lark_webhook_subscription_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "lark_webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lark_dm_bridge_config" ADD CONSTRAINT "lark_dm_bridge_config_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

