-- P128: Invoice Pembelian (Purchasing-Concept.md B28–B31).

-- CreateTable
CREATE TABLE "fin_ap_invoice" (
    "id" SERIAL NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'Draft',
    "purchase_order_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "supplier_invoice_no" TEXT NOT NULL,
    "supplier_invoice_date" DATE NOT NULL,
    "supplier_tax_invoice_no" TEXT,
    "price_mode" "PriceMode" NOT NULL,
    "is_taxable" BOOLEAN NOT NULL,
    "ppn_rate" DECIMAL(9,4),
    "ppn_dpp_other_numerator" INTEGER,
    "ppn_dpp_other_denominator" INTEGER,
    "dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advance_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advance_ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pph_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "supplier_total" DECIMAL(18,2),
    "difference_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payable_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "ap_item_id" INTEGER,
    "note" TEXT,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ap_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_ap_invoice_line" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "receipt_note_line_id" INTEGER NOT NULL,
    "purchase_order_line_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "dpp_amount" DECIMAL(18,2) NOT NULL,
    "advance_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_dpp_amount" DECIMAL(18,2) NOT NULL,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "withholding_tax_id" INTEGER,
    "withholding_rate" DECIMAL(9,4),

    CONSTRAINT "fin_ap_invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_ap_invoice_advance_deduction" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "ap_item_id" INTEGER NOT NULL,
    "ap_item_no" TEXT NOT NULL,
    "dpp_used" DECIMAL(18,2) NOT NULL,
    "ppn_used" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fin_ap_invoice_advance_deduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_ap_invoice_invoice_no_key" ON "fin_ap_invoice"("invoice_no");

-- CreateIndex
CREATE INDEX "fin_ap_invoice_purchase_order_id_idx" ON "fin_ap_invoice"("purchase_order_id");

-- CreateIndex
CREATE INDEX "fin_ap_invoice_supplier_id_supplier_invoice_no_idx" ON "fin_ap_invoice"("supplier_id", "supplier_invoice_no");

-- CreateIndex
CREATE INDEX "fin_ap_invoice_status_invoice_date_idx" ON "fin_ap_invoice"("status", "invoice_date");

-- CreateIndex
CREATE INDEX "fin_ap_invoice_line_receipt_note_line_id_idx" ON "fin_ap_invoice_line"("receipt_note_line_id");

-- CreateIndex
CREATE INDEX "fin_ap_invoice_line_purchase_order_line_id_idx" ON "fin_ap_invoice_line"("purchase_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ap_invoice_line_invoice_id_line_no_key" ON "fin_ap_invoice_line"("invoice_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ap_invoice_line_invoice_id_receipt_note_line_id_key" ON "fin_ap_invoice_line"("invoice_id", "receipt_note_line_id");

-- CreateIndex
CREATE INDEX "fin_ap_invoice_advance_deduction_ap_item_id_idx" ON "fin_ap_invoice_advance_deduction"("ap_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ap_invoice_advance_deduction_invoice_id_ap_item_id_key" ON "fin_ap_invoice_advance_deduction"("invoice_id", "ap_item_id");

-- AddForeignKey
ALTER TABLE "fin_ap_invoice" ADD CONSTRAINT "fin_ap_invoice_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ap_invoice_line" ADD CONSTRAINT "fin_ap_invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "fin_ap_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ap_invoice_advance_deduction" ADD CONSTRAINT "fin_ap_invoice_advance_deduction_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "fin_ap_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

