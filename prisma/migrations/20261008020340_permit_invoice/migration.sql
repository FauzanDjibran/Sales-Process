-- CreateTable
CREATE TABLE "fin_ar_permit_invoice" (
    "id" SERIAL NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "tax_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'Draft',
    "permit_request_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "price_mode" "PriceMode" NOT NULL,
    "is_taxable" BOOLEAN NOT NULL,
    "ppn_rate" DECIMAL(9,4),
    "ppn_dpp_other_numerator" INTEGER,
    "ppn_dpp_other_denominator" INTEGER,
    "withholding_tax_id" INTEGER,
    "withholding_rate" DECIMAL(9,4),
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advance_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advance_ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "full_ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "ar_item_id" INTEGER,
    "note" TEXT,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ar_permit_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_ar_permit_invoice_advance_deduction" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "ar_item_id" INTEGER NOT NULL,
    "ar_item_no" TEXT NOT NULL,
    "dpp_used" DECIMAL(18,2) NOT NULL,
    "ppn_used" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fin_ar_permit_invoice_advance_deduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_permit_invoice_invoice_no_key" ON "fin_ar_permit_invoice"("invoice_no");

-- CreateIndex
CREATE INDEX "fin_ar_permit_invoice_permit_request_id_idx" ON "fin_ar_permit_invoice"("permit_request_id");

-- CreateIndex
CREATE INDEX "fin_ar_permit_invoice_status_invoice_date_idx" ON "fin_ar_permit_invoice"("status", "invoice_date");

-- CreateIndex
CREATE INDEX "fin_ar_permit_invoice_advance_deduction_ar_item_id_idx" ON "fin_ar_permit_invoice_advance_deduction"("ar_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_permit_invoice_advance_deduction_invoice_id_ar_item__key" ON "fin_ar_permit_invoice_advance_deduction"("invoice_id", "ar_item_id");

-- AddForeignKey
ALTER TABLE "fin_ar_permit_invoice" ADD CONSTRAINT "fin_ar_permit_invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_permit_invoice" ADD CONSTRAINT "fin_ar_permit_invoice_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "m_partner_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_permit_invoice" ADD CONSTRAINT "fin_ar_permit_invoice_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_permit_invoice_advance_deduction" ADD CONSTRAINT "fin_ar_permit_invoice_advance_deduction_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "fin_ar_permit_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
