-- CreateTable
CREATE TABLE "fin_ar_permit_advance" (
    "id" SERIAL NOT NULL,
    "advance_no" TEXT NOT NULL,
    "advance_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'Draft',
    "permit_request_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "price_mode" "PriceMode" NOT NULL,
    "is_taxable" BOOLEAN NOT NULL,
    "withholding_tax_id" INTEGER,
    "withholding_rate" DECIMAL(9,4),
    "ppn_rate" DECIMAL(9,4),
    "ppn_dpp_other_numerator" INTEGER,
    "ppn_dpp_other_denominator" INTEGER,
    "amount_type" "AdvanceAmountType" NOT NULL,
    "amount_value" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dpp_amount" DECIMAL(18,2) NOT NULL,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL,
    "ppn_amount" DECIMAL(18,2) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ar_permit_advance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_permit_advance_advance_no_key" ON "fin_ar_permit_advance"("advance_no");

-- CreateIndex
CREATE INDEX "fin_ar_permit_advance_permit_request_id_idx" ON "fin_ar_permit_advance"("permit_request_id");

-- CreateIndex
CREATE INDEX "fin_ar_permit_advance_customer_id_idx" ON "fin_ar_permit_advance"("customer_id");

-- CreateIndex
CREATE INDEX "fin_ar_permit_advance_status_advance_date_idx" ON "fin_ar_permit_advance"("status", "advance_date");

-- AddForeignKey
ALTER TABLE "fin_ar_permit_advance" ADD CONSTRAINT "fin_ar_permit_advance_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_permit_advance" ADD CONSTRAINT "fin_ar_permit_advance_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
