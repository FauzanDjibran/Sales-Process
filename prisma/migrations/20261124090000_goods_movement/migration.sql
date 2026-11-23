-- Goods movement (P317, Goods-Movement-Plan.md steps 1-6). Development data is not
-- converted (the user, 23/11/2026): reset the database after it.

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('Submitted', 'Posted');

-- DropForeignKey
ALTER TABLE "log_production_receipt" DROP CONSTRAINT "log_production_receipt_from_unit_id_fkey";

-- DropForeignKey
ALTER TABLE "log_production_receipt" DROP CONSTRAINT "log_production_receipt_warehouse_id_fkey";

-- DropForeignKey
ALTER TABLE "log_production_receipt_line" DROP CONSTRAINT "log_production_receipt_line_item_id_fkey";

-- DropForeignKey
ALTER TABLE "log_production_receipt_line" DROP CONSTRAINT "log_production_receipt_line_receipt_id_fkey";

-- DropIndex
DROP INDEX "prd_balance_tracking_id_unit_id_stage_unit_step_id_partai_i_key";

-- AlterTable
ALTER TABLE "log_stock_balance" DROP COLUMN "reserved_qty";

-- AlterTable
ALTER TABLE "log_stock_issue" ADD COLUMN     "received_at" DATE;

-- AlterTable
ALTER TABLE "log_stock_issue_line" DROP COLUMN "unit_cost";

-- AlterTable
ALTER TABLE "log_stock_issue_tracking" DROP COLUMN "prd_bucket_id",
DROP COLUMN "unit_cost";

-- DropTable
DROP TABLE "log_production_receipt";

-- DropTable
DROP TABLE "log_production_receipt_line";

-- DropEnum
DROP TYPE "ProductionReceiptStatus";

-- CreateTable
CREATE TABLE "prd_receipt" (
    "id" SERIAL NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "warehouse_code" TEXT NOT NULL,
    "warehouse_name" TEXT NOT NULL,
    "sent_date" DATE NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'Submitted',
    "received_at" DATE,
    "received_by" INTEGER,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_receipt_line" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "job_id" INTEGER,
    "bucket_id" INTEGER,

    CONSTRAINT "prd_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_issue" (
    "id" SERIAL NOT NULL,
    "issue_no" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "reason" TEXT,
    "unit_id" INTEGER NOT NULL,
    "warehouse_code" TEXT NOT NULL,
    "warehouse_name" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'Submitted',
    "received_at" DATE,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_issue_line" (
    "id" SERIAL NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "job_id" INTEGER,
    "partai_id" INTEGER,
    "qty" DECIMAL(18,6) NOT NULL,
    "grams" DECIMAL(18,6),
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "from_bucket_id" INTEGER NOT NULL,
    "transit_bucket_id" INTEGER NOT NULL,

    CONSTRAINT "prd_issue_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_receipt" (
    "id" SERIAL NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "receipt_date" DATE NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'Submitted',
    "from_unit_id" INTEGER,
    "warehouse_id" INTEGER NOT NULL,
    "note" TEXT,
    "received_at" DATE,
    "received_by" INTEGER,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "value_mode" TEXT,
    "written_off_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_receipt_line" (
    "id" SERIAL NOT NULL,
    "stock_receipt_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "base_qty" DECIMAL(18,6) NOT NULL,
    "value_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "log_stock_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_receipt_tracking" (
    "id" SERIAL NOT NULL,
    "stock_receipt_line_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "tracking_no" TEXT NOT NULL,
    "expiry_date" DATE,
    "job_no" TEXT,
    "base_qty" DECIMAL(18,6) NOT NULL,
    "grams" DECIMAL(18,6),
    "value_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "location_id" INTEGER,
    "stock_status_id" INTEGER,

    CONSTRAINT "log_stock_receipt_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_receipt_receipt_no_key" ON "prd_receipt"("receipt_no");

-- CreateIndex
CREATE INDEX "prd_receipt_unit_id_status_idx" ON "prd_receipt"("unit_id", "status");

-- CreateIndex
CREATE INDEX "prd_receipt_line_tracking_id_idx" ON "prd_receipt_line"("tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_receipt_line_receipt_id_line_no_key" ON "prd_receipt_line"("receipt_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "prd_issue_issue_no_key" ON "prd_issue"("issue_no");

-- CreateIndex
CREATE INDEX "prd_issue_unit_id_status_idx" ON "prd_issue"("unit_id", "status");

-- CreateIndex
CREATE INDEX "prd_issue_line_tracking_id_idx" ON "prd_issue_line"("tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_issue_line_issue_id_line_no_key" ON "prd_issue_line"("issue_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_receipt_receipt_no_key" ON "log_stock_receipt"("receipt_no");

-- CreateIndex
CREATE INDEX "log_stock_receipt_purpose_status_idx" ON "log_stock_receipt"("purpose", "status");

-- CreateIndex
CREATE INDEX "log_stock_receipt_status_receipt_date_idx" ON "log_stock_receipt"("status", "receipt_date");

-- CreateIndex
CREATE INDEX "log_stock_receipt_warehouse_id_idx" ON "log_stock_receipt"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_receipt_line_stock_receipt_id_line_no_key" ON "log_stock_receipt_line"("stock_receipt_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_receipt_line_stock_receipt_id_item_id_key" ON "log_stock_receipt_line"("stock_receipt_id", "item_id");

-- CreateIndex
CREATE INDEX "log_stock_receipt_tracking_tracking_no_idx" ON "log_stock_receipt_tracking"("tracking_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_receipt_tracking_stock_receipt_line_id_seq_key" ON "log_stock_receipt_tracking"("stock_receipt_line_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "prd_balance_bucket_key" ON "prd_balance"("tracking_id", "unit_id", "stage", "unit_step_id", "partai_id", "job_id", "qc_check_id", "transit_doc_type_id", "transit_doc_id");

-- AddForeignKey
ALTER TABLE "prd_receipt" ADD CONSTRAINT "prd_receipt_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_receipt_line" ADD CONSTRAINT "prd_receipt_line_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "prd_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_receipt_line" ADD CONSTRAINT "prd_receipt_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_issue" ADD CONSTRAINT "prd_issue_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_issue_line" ADD CONSTRAINT "prd_issue_line_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "prd_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_issue_line" ADD CONSTRAINT "prd_issue_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_receipt" ADD CONSTRAINT "log_stock_receipt_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "ref_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_receipt" ADD CONSTRAINT "log_stock_receipt_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_receipt_line" ADD CONSTRAINT "log_stock_receipt_line_stock_receipt_id_fkey" FOREIGN KEY ("stock_receipt_id") REFERENCES "log_stock_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_receipt_line" ADD CONSTRAINT "log_stock_receipt_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_receipt_tracking" ADD CONSTRAINT "log_stock_receipt_tracking_stock_receipt_line_id_fkey" FOREIGN KEY ("stock_receipt_line_id") REFERENCES "log_stock_receipt_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A bucket is one identity whatever is empty in it.
DROP INDEX "prd_balance_bucket_key";
CREATE UNIQUE INDEX "prd_balance_bucket_key" ON "prd_balance" ("tracking_id", "unit_id", "stage", "unit_step_id", "partai_id", "job_id", "qc_check_id", "transit_doc_type_id", "transit_doc_id") NULLS NOT DISTINCT;

ALTER TABLE "log_stock_receipt" ADD CONSTRAINT "log_stock_receipt_value_mode" CHECK ("value_mode" IS NULL OR "value_mode" IN ('carried', 'none'));
ALTER TABLE "log_stock_receipt" ADD CONSTRAINT "log_stock_receipt_written_off" CHECK ("written_off_amount" >= 0 AND "written_off_amount" <= "cost_amount");
ALTER TABLE "log_stock_receipt_tracking" ADD CONSTRAINT "log_stock_receipt_tracking_qty" CHECK ("base_qty" > 0 AND "value_amount" >= 0);
ALTER TABLE "prd_receipt_line" ADD CONSTRAINT "prd_receipt_line_qty" CHECK ("qty" > 0 AND "value" >= 0);
ALTER TABLE "prd_issue_line" ADD CONSTRAINT "prd_issue_line_qty" CHECK ("qty" > 0 AND "value" >= 0);

-- Document types: the receipt becomes the generic one; production gets two of its own (seeded).
UPDATE "sys_doc_type" SET "doc_table" = 'log_stock_receipt', "doc_label" = 'Stock Receipt', "doc_name" = 'Stock Receipt' WHERE "doc_table" = 'log_production_receipt';
UPDATE "sys_doc_type" SET "doc_label" = 'Stock Issue', "doc_name" = 'Stock Issue' WHERE "doc_table" = 'log_stock_issue';

-- Permissions: renamed in place, so every role keeps its work (the seed writes the names).
UPDATE "sys_permission" SET "permission_code" = 'STOCK_RECEIPT_VIEW' WHERE "permission_code" = 'PRODUCTION_RECEIPT_VIEW';
UPDATE "sys_permission" SET "permission_code" = 'STOCK_RECEIPT_RECEIVE' WHERE "permission_code" = 'PRODUCTION_RECEIPT_RECEIVE';
UPDATE "sys_permission" SET "permission_code" = 'PRODUCTION_RECEIPT_RECEIVE', "module" = 'production' WHERE "permission_code" = 'STOCK_ISSUE_POST';
UPDATE "sys_permission" SET "permission_code" = 'PRODUCTION_ISSUE_SEND' WHERE "permission_code" = 'PRODUCTION_RECEIPT_SEND';
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at")
VALUES ('PRODUCTION_RECEIPT_VIEW', 'Lihat Production Receipt', 'production', now()), ('PRODUCTION_ISSUE_VIEW', 'Lihat Production Issue', 'production', now())
ON CONFLICT ("permission_code") DO NOTHING;
INSERT INTO "sys_role_permission" ("role_id", "permission_id", "created_by")
SELECT DISTINCT rp."role_id", n."id", 1 FROM "sys_role_permission" rp
  JOIN "sys_permission" o ON o."id" = rp."permission_id" AND o."permission_code" = 'PRODUCTION_UNIT_VIEW'
  CROSS JOIN "sys_permission" n
 WHERE n."permission_code" IN ('PRODUCTION_RECEIPT_VIEW', 'PRODUCTION_ISSUE_VIEW')
ON CONFLICT DO NOTHING;
