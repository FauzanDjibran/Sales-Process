-- P126: Uang Muka Pembelian (Purchasing-Concept.md B23), the AP advance bill.

-- CreateTable
CREATE TABLE "fin_ap_advance" (
    "id" SERIAL NOT NULL,
    "advance_no" TEXT NOT NULL,
    "advance_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'Draft',
    "purchase_order_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "supplier_ref_no" TEXT,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "price_mode" "PriceMode" NOT NULL,
    "is_taxable" BOOLEAN NOT NULL,
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
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ap_advance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_ap_advance_advance_no_key" ON "fin_ap_advance"("advance_no");

-- CreateIndex
CREATE INDEX "fin_ap_advance_purchase_order_id_idx" ON "fin_ap_advance"("purchase_order_id");

-- CreateIndex
CREATE INDEX "fin_ap_advance_supplier_id_idx" ON "fin_ap_advance"("supplier_id");

-- CreateIndex
CREATE INDEX "fin_ap_advance_status_advance_date_idx" ON "fin_ap_advance"("status", "advance_date");

-- AddForeignKey
ALTER TABLE "fin_ap_advance" ADD CONSTRAINT "fin_ap_advance_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

