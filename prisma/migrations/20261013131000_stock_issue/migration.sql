-- CreateEnum
CREATE TYPE "StockIssueStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "log_stock_issue" (
    "id" SERIAL NOT NULL,
    "issue_no" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "status" "StockIssueStatus" NOT NULL DEFAULT 'Draft',
    "purpose" TEXT NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "workstation_id" INTEGER,
    "note" TEXT,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_issue_line" (
    "id" SERIAL NOT NULL,
    "stock_issue_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "uom_factor" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "qty" DECIMAL(18,4) NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "log_stock_issue_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_issue_lot" (
    "id" SERIAL NOT NULL,
    "stock_issue_line_id" INTEGER NOT NULL,
    "pick_no" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "location_id" INTEGER,
    "lot_no" TEXT NOT NULL,
    "expiry_date" DATE,
    "qty" DECIMAL(18,4) NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "prd_lot_id" INTEGER,
    "prd_bucket_id" INTEGER,

    CONSTRAINT "log_stock_issue_lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_issue_issue_no_key" ON "log_stock_issue"("issue_no");

-- CreateIndex
CREATE INDEX "log_stock_issue_purpose_status_idx" ON "log_stock_issue"("purpose", "status");

-- CreateIndex
CREATE INDEX "log_stock_issue_status_issue_date_idx" ON "log_stock_issue"("status", "issue_date");

-- CreateIndex
CREATE INDEX "log_stock_issue_line_item_id_idx" ON "log_stock_issue_line"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_issue_line_stock_issue_id_line_no_key" ON "log_stock_issue_line"("stock_issue_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_issue_line_stock_issue_id_item_id_key" ON "log_stock_issue_line"("stock_issue_id", "item_id");

-- CreateIndex
CREATE INDEX "log_stock_issue_lot_lot_id_idx" ON "log_stock_issue_lot"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_issue_lot_stock_issue_line_id_pick_no_key" ON "log_stock_issue_lot"("stock_issue_line_id", "pick_no");

-- A pick is a lot in a location; a warehouse without locations keeps one bucket
-- per lot, so a null location must clash with another null (P136).
-- CreateIndex
CREATE UNIQUE INDEX "log_stock_issue_lot_pick_key" ON "log_stock_issue_lot"("stock_issue_line_id", "lot_id", "location_id") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "log_stock_issue" ADD CONSTRAINT "log_stock_issue_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_issue" ADD CONSTRAINT "log_stock_issue_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_issue_line" ADD CONSTRAINT "log_stock_issue_line_stock_issue_id_fkey" FOREIGN KEY ("stock_issue_id") REFERENCES "log_stock_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_issue_line" ADD CONSTRAINT "log_stock_issue_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_issue_line" ADD CONSTRAINT "log_stock_issue_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_issue_lot" ADD CONSTRAINT "log_stock_issue_lot_stock_issue_line_id_fkey" FOREIGN KEY ("stock_issue_line_id") REFERENCES "log_stock_issue_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
