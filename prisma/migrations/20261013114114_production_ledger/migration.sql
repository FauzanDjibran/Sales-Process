-- CreateEnum
CREATE TYPE "PrdLotOrigin" AS ENUM ('Issued', 'Produced');

-- CreateEnum
CREATE TYPE "PrdMovement" AS ENUM ('Issued', 'Consumed', 'Produced', 'Released', 'Revalued');

-- CreateTable
CREATE TABLE "prd_batch" (
    "id" SERIAL NOT NULL,
    "batch_no" TEXT NOT NULL,
    "batch_date" DATE NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "customer_order_id" INTEGER,
    "customer_order_no" TEXT,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_batch_parent" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "parent_batch_id" INTEGER NOT NULL,

    CONSTRAINT "prd_batch_parent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_lot" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "lot_no" TEXT NOT NULL,
    "batch_id" INTEGER,
    "expiry_date" DATE,
    "origin" "PrdLotOrigin" NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_balance" (
    "id" SERIAL NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "qty_balance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "value_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_ledger" (
    "id" SERIAL NOT NULL,
    "ledger_no" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "posting_date" DATE NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "movement" "PrdMovement" NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty_change" DECIMAL(18,6) NOT NULL,
    "qty_balance" DECIMAL(18,6) NOT NULL,
    "value_change" DECIMAL(18,2) NOT NULL,
    "value_balance" DECIMAL(18,2) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_lot_link" (
    "id" SERIAL NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "from_bucket_id" INTEGER NOT NULL,
    "from_lot_id" INTEGER NOT NULL,
    "to_lot_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_lot_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_batch_batch_no_key" ON "prd_batch"("batch_no");

-- CreateIndex
CREATE INDEX "prd_batch_source_doc_type_id_source_doc_id_idx" ON "prd_batch"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_batch_parent_batch_id_parent_batch_id_key" ON "prd_batch_parent"("batch_id", "parent_batch_id");

-- CreateIndex
CREATE INDEX "prd_lot_batch_id_idx" ON "prd_lot"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_lot_item_id_lot_no_key" ON "prd_lot"("item_id", "lot_no");

-- CreateIndex
CREATE INDEX "prd_balance_workstation_id_idx" ON "prd_balance"("workstation_id");

-- CreateIndex
CREATE INDEX "prd_balance_item_id_idx" ON "prd_balance"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_balance_lot_id_workstation_id_key" ON "prd_balance"("lot_id", "workstation_id");

-- CreateIndex
CREATE INDEX "prd_ledger_bucket_id_posting_date_idx" ON "prd_ledger"("bucket_id", "posting_date");

-- CreateIndex
CREATE INDEX "prd_ledger_lot_id_idx" ON "prd_ledger"("lot_id");

-- CreateIndex
CREATE INDEX "prd_ledger_source_doc_type_id_source_doc_id_idx" ON "prd_ledger"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_ledger_ledger_no_line_no_key" ON "prd_ledger"("ledger_no", "line_no");

-- CreateIndex
CREATE INDEX "prd_lot_link_source_doc_type_id_source_doc_id_idx" ON "prd_lot_link"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "prd_lot_link_from_lot_id_idx" ON "prd_lot_link"("from_lot_id");

-- CreateIndex
CREATE INDEX "prd_lot_link_to_lot_id_idx" ON "prd_lot_link"("to_lot_id");

-- AddForeignKey
ALTER TABLE "prd_batch_parent" ADD CONSTRAINT "prd_batch_parent_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "prd_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_batch_parent" ADD CONSTRAINT "prd_batch_parent_parent_batch_id_fkey" FOREIGN KEY ("parent_batch_id") REFERENCES "prd_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_lot" ADD CONSTRAINT "prd_lot_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_lot" ADD CONSTRAINT "prd_lot_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "prd_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "prd_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_ledger" ADD CONSTRAINT "prd_ledger_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "prd_balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_ledger" ADD CONSTRAINT "prd_ledger_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "prd_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_ledger" ADD CONSTRAINT "prd_ledger_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_ledger" ADD CONSTRAINT "prd_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_lot_link" ADD CONSTRAINT "prd_lot_link_from_bucket_id_fkey" FOREIGN KEY ("from_bucket_id") REFERENCES "prd_balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_lot_link" ADD CONSTRAINT "prd_lot_link_from_lot_id_fkey" FOREIGN KEY ("from_lot_id") REFERENCES "prd_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_lot_link" ADD CONSTRAINT "prd_lot_link_to_lot_id_fkey" FOREIGN KEY ("to_lot_id") REFERENCES "prd_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A bucket never goes below zero, and an empty one holds no value (P150 E2,
-- as the stock books' balances, P120).
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_qty_nonneg" CHECK ("qty_balance" >= 0);
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_value_nonneg" CHECK ("value_balance" >= 0);
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_empty_no_value" CHECK ("qty_balance" > 0 OR "value_balance" = 0);
