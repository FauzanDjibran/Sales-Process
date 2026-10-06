-- P125: the Receipt Note (Purchasing-Concept.md B17–B22), standalone under Logistik.

-- CreateEnum
CREATE TYPE "ReceiptNoteStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "log_receipt_note" (
    "id" SERIAL NOT NULL,
    "rn_no" TEXT NOT NULL,
    "rn_date" DATE NOT NULL,
    "status" "ReceiptNoteStatus" NOT NULL DEFAULT 'Draft',
    "purpose" TEXT NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER,
    "supplier_dn_no" TEXT,
    "note" TEXT,
    "value_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_receipt_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_receipt_note_line" (
    "id" SERIAL NOT NULL,
    "receipt_note_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "source_doc_line_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "uom_factor" DECIMAL(18,4) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL,
    "is_stock" BOOLEAN NOT NULL DEFAULT false,
    "value_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "log_receipt_note_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_receipt_note_lot" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "lot_seq" INTEGER NOT NULL,
    "lot_no" TEXT,
    "expiry_date" DATE,
    "qty" DECIMAL(18,4) NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tracking_id" INTEGER,

    CONSTRAINT "log_receipt_note_lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "log_receipt_note_rn_no_key" ON "log_receipt_note"("rn_no");

-- CreateIndex
CREATE INDEX "log_receipt_note_source_doc_type_id_source_doc_id_idx" ON "log_receipt_note"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "log_receipt_note_purpose_status_idx" ON "log_receipt_note"("purpose", "status");

-- CreateIndex
CREATE INDEX "log_receipt_note_status_rn_date_idx" ON "log_receipt_note"("status", "rn_date");

-- CreateIndex
CREATE INDEX "log_receipt_note_line_source_doc_line_id_idx" ON "log_receipt_note_line"("source_doc_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_receipt_note_line_receipt_note_id_line_no_key" ON "log_receipt_note_line"("receipt_note_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_receipt_note_line_receipt_note_id_source_doc_line_id_key" ON "log_receipt_note_line"("receipt_note_id", "source_doc_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_receipt_note_lot_line_id_lot_seq_key" ON "log_receipt_note_lot"("line_id", "lot_seq");

-- AddForeignKey
ALTER TABLE "log_receipt_note" ADD CONSTRAINT "log_receipt_note_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_receipt_note" ADD CONSTRAINT "log_receipt_note_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_receipt_note" ADD CONSTRAINT "log_receipt_note_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_receipt_note_line" ADD CONSTRAINT "log_receipt_note_line_receipt_note_id_fkey" FOREIGN KEY ("receipt_note_id") REFERENCES "log_receipt_note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_receipt_note_line" ADD CONSTRAINT "log_receipt_note_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_receipt_note_line" ADD CONSTRAINT "log_receipt_note_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_receipt_note_lot" ADD CONSTRAINT "log_receipt_note_lot_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "log_receipt_note_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

