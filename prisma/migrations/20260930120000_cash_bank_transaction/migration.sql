-- Penerimaan / Pengeluaran Kas & Bank (Claude-ERP.md P66–P70): one table for
-- both directions, the documents each settles, and the PPh withheld per line
-- per Jenis PPh.

-- CreateEnum
CREATE TYPE "CashBankTxStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "fin_cash_bank_tx" (
    "id" SERIAL NOT NULL,
    "tx_no" TEXT NOT NULL,
    "direction" "FlowDirection" NOT NULL,
    "purpose" TEXT NOT NULL,
    "tx_date" DATE NOT NULL,
    "status" "CashBankTxStatus" NOT NULL DEFAULT 'Draft',
    "partner_id" INTEGER NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "bank_ref" TEXT,
    "note" TEXT,
    "cash_amount" DECIMAL(18,2) NOT NULL,
    "bank_charge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "settled_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pph_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_tx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_bank_tx_line" (
    "id" SERIAL NOT NULL,
    "tx_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "doc_type_id" INTEGER NOT NULL,
    "doc_id" INTEGER NOT NULL,
    "settled_amount" DECIMAL(18,2) NOT NULL,
    "withhold" BOOLEAN NOT NULL DEFAULT true,
    "dpp_part" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_part" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pph_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_bank_tx_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_bank_tx_line_wht" (
    "id" SERIAL NOT NULL,
    "line_id" INTEGER NOT NULL,
    "withholding_tax_id" INTEGER NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "fin_cash_bank_tx_line_wht_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_tx_tx_no_key" ON "fin_cash_bank_tx"("tx_no");

-- CreateIndex
CREATE INDEX "fin_cash_bank_tx_direction_status_tx_date_idx" ON "fin_cash_bank_tx"("direction", "status", "tx_date");

-- CreateIndex
CREATE INDEX "fin_cash_bank_tx_partner_id_idx" ON "fin_cash_bank_tx"("partner_id");

-- CreateIndex
CREATE INDEX "fin_cash_bank_tx_line_doc_type_id_doc_id_idx" ON "fin_cash_bank_tx_line"("doc_type_id", "doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_tx_line_tx_id_doc_type_id_doc_id_key" ON "fin_cash_bank_tx_line"("tx_id", "doc_type_id", "doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_bank_tx_line_wht_line_id_withholding_tax_id_key" ON "fin_cash_bank_tx_line_wht"("line_id", "withholding_tax_id");

-- AddForeignKey
ALTER TABLE "fin_cash_bank_tx" ADD CONSTRAINT "fin_cash_bank_tx_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_tx" ADD CONSTRAINT "fin_cash_bank_tx_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_tx" ADD CONSTRAINT "fin_cash_bank_tx_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "acc_journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_tx_line" ADD CONSTRAINT "fin_cash_bank_tx_line_tx_id_fkey" FOREIGN KEY ("tx_id") REFERENCES "fin_cash_bank_tx"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_tx_line" ADD CONSTRAINT "fin_cash_bank_tx_line_doc_type_id_fkey" FOREIGN KEY ("doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_tx_line_wht" ADD CONSTRAINT "fin_cash_bank_tx_line_wht_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "fin_cash_bank_tx_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_bank_tx_line_wht" ADD CONSTRAINT "fin_cash_bank_tx_line_wht_withholding_tax_id_fkey" FOREIGN KEY ("withholding_tax_id") REFERENCES "ref_withholding_tax"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

