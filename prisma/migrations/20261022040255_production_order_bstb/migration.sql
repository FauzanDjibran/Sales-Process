-- Walet build step 3 (production_project.md M113, M121; walet/build-plan.md step 3):
-- the Perintah Produksi, and the Stock Issue as the Logistik BSTB — sent into
-- transit, received or rejected whole at the workstation.

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('Draft', 'Open', 'Closed', 'Cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PrdMovement" ADD VALUE 'Received';
ALTER TYPE "PrdMovement" ADD VALUE 'Returned';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockIssueStatus" ADD VALUE 'Received';
ALTER TYPE "StockIssueStatus" ADD VALUE 'Rejected';

-- AlterTable
ALTER TABLE "log_stock_issue" ADD COLUMN     "received_by" INTEGER,
ADD COLUMN     "received_date" DATE,
ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "return_journal_id" INTEGER,
ADD COLUMN     "source_doc_id" INTEGER,
ADD COLUMN     "source_doc_type_id" INTEGER,
ADD COLUMN     "source_no" TEXT;

-- AlterTable
ALTER TABLE "log_stock_issue_lot" ADD COLUMN     "received_bucket_id" INTEGER;

-- CreateTable
CREATE TABLE "prd_order" (
    "id" SERIAL NOT NULL,
    "order_no" TEXT NOT NULL,
    "order_date" DATE NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'Draft',
    "target_item_id" INTEGER NOT NULL,
    "routing_id" INTEGER,
    "warehouse_id" INTEGER NOT NULL,
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_order_step" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "step_no" INTEGER NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "mode" "RoutingStepMode" NOT NULL,
    "bom_id" INTEGER,

    CONSTRAINT "prd_order_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_order_lot" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "note" TEXT,

    CONSTRAINT "prd_order_lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_order_order_no_key" ON "prd_order"("order_no");

-- CreateIndex
CREATE INDEX "prd_order_status_order_date_idx" ON "prd_order"("status", "order_date");

-- CreateIndex
CREATE INDEX "prd_order_step_workstation_id_idx" ON "prd_order_step"("workstation_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_order_step_order_id_step_no_key" ON "prd_order_step"("order_id", "step_no");

-- CreateIndex
CREATE INDEX "prd_order_lot_lot_id_idx" ON "prd_order_lot"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_order_lot_order_id_line_no_key" ON "prd_order_lot"("order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "prd_order_lot_order_id_lot_id_key" ON "prd_order_lot"("order_id", "lot_id");

-- CreateIndex
CREATE INDEX "log_stock_issue_source_doc_type_id_source_doc_id_idx" ON "log_stock_issue"("source_doc_type_id", "source_doc_id");

-- AddForeignKey
ALTER TABLE "prd_order" ADD CONSTRAINT "prd_order_target_item_id_fkey" FOREIGN KEY ("target_item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order" ADD CONSTRAINT "prd_order_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "prd_routing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order" ADD CONSTRAINT "prd_order_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_step" ADD CONSTRAINT "prd_order_step_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "prd_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_step" ADD CONSTRAINT "prd_order_step_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_step" ADD CONSTRAINT "prd_order_step_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "prd_bom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_lot" ADD CONSTRAINT "prd_order_lot_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "prd_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_lot" ADD CONSTRAINT "prd_order_lot_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_lot" ADD CONSTRAINT "prd_order_lot_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_lot" ADD CONSTRAINT "prd_order_lot_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
