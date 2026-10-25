-- CreateEnum
CREATE TYPE "ExecutionKind" AS ENUM ('Mix', 'Transform', 'PassThrough');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateEnum
CREATE TYPE "ExecutionOutputStatus" AS ENUM ('Available', 'Reject');

-- AlterTable
ALTER TABLE "prd_balance" ADD COLUMN     "is_reject" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "prd_execution" (
    "id" SERIAL NOT NULL,
    "execution_no" TEXT NOT NULL,
    "execution_date" DATE NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'Draft',
    "kind" "ExecutionKind" NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "partai_id" INTEGER,
    "note" TEXT,
    "cancel_reason" TEXT,
    "journal_id" INTEGER,
    "standard_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_execution_section" (
    "id" SERIAL NOT NULL,
    "execution_id" INTEGER NOT NULL,
    "section_no" INTEGER NOT NULL,
    "job_id" INTEGER,
    "driver" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "standard_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "prd_execution_section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_execution_input" (
    "id" SERIAL NOT NULL,
    "section_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "source_bucket_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "lot_no" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "prd_execution_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_execution_output" (
    "id" SERIAL NOT NULL,
    "section_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "lot_no" TEXT,
    "expiry_date" DATE,
    "qty" DECIMAL(18,6) NOT NULL,
    "status" "ExecutionOutputStatus" NOT NULL DEFAULT 'Available',
    "weight" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lot_id" INTEGER,
    "bucket_id" INTEGER,

    CONSTRAINT "prd_execution_output_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_execution_cost" (
    "id" SERIAL NOT NULL,
    "execution_id" INTEGER NOT NULL,
    "standard_cost_item_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "cost_center_id" INTEGER NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "driver" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "prd_execution_cost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_execution_execution_no_key" ON "prd_execution"("execution_no");

-- CreateIndex
CREATE INDEX "prd_execution_status_execution_date_idx" ON "prd_execution"("status", "execution_date");

-- CreateIndex
CREATE INDEX "prd_execution_workstation_id_execution_date_idx" ON "prd_execution"("workstation_id", "execution_date");

-- CreateIndex
CREATE UNIQUE INDEX "prd_execution_section_execution_id_section_no_key" ON "prd_execution_section"("execution_id", "section_no");

-- CreateIndex
CREATE UNIQUE INDEX "prd_execution_input_section_id_line_no_key" ON "prd_execution_input"("section_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "prd_execution_output_section_id_line_no_key" ON "prd_execution_output"("section_id", "line_no");

-- CreateIndex
CREATE INDEX "prd_execution_cost_execution_id_idx" ON "prd_execution_cost"("execution_id");

-- AddForeignKey
ALTER TABLE "prd_execution" ADD CONSTRAINT "prd_execution_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_execution_section" ADD CONSTRAINT "prd_execution_section_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "prd_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_execution_input" ADD CONSTRAINT "prd_execution_input_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "prd_execution_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_execution_output" ADD CONSTRAINT "prd_execution_output_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "prd_execution_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_execution_cost" ADD CONSTRAINT "prd_execution_cost_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "prd_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "prd_execution_input" ADD CONSTRAINT "prd_execution_input_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "prd_execution_output" ADD CONSTRAINT "prd_execution_output_qty_positive" CHECK ("qty" > 0);

-- Permissions of the Eksekusi Produksi (P169): the nearest Perintah / hand-over permission keeps the matching one.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('PRODUCTION_EXECUTION_VIEW', 'Lihat Eksekusi Produksi', 'production', now()),
  ('PRODUCTION_EXECUTION_CREATE', 'Buat Eksekusi Produksi', 'production', now()),
  ('PRODUCTION_EXECUTION_EDIT', 'Ubah Eksekusi Produksi', 'production', now()),
  ('PRODUCTION_EXECUTION_POST', 'Posting Eksekusi Produksi', 'production', now()),
  ('PRODUCTION_EXECUTION_CANCEL', 'Batalkan Eksekusi Produksi', 'production', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", n."id"
  FROM (VALUES
    ('PRODUCTION_HANDOVER_VIEW', 'PRODUCTION_EXECUTION_VIEW'),
    ('PRODUCTION_HANDOVER_CREATE', 'PRODUCTION_EXECUTION_CREATE'),
    ('PRODUCTION_HANDOVER_EDIT', 'PRODUCTION_EXECUTION_EDIT'),
    ('PRODUCTION_HANDOVER_POST', 'PRODUCTION_EXECUTION_POST'),
    ('PRODUCTION_HANDOVER_CANCEL', 'PRODUCTION_EXECUTION_CANCEL')
  ) AS m(held, given)
  JOIN "sys_permission" h ON h."permission_code" = m.held
  JOIN "sys_role_permission" rp ON rp."permission_id" = h."id"
  JOIN "sys_permission" n ON n."permission_code" = m.given
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
