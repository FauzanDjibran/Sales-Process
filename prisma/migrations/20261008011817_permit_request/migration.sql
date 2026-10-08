-- CreateEnum
CREATE TYPE "PermitRequestStatus" AS ENUM ('Draft', 'Submitted', 'Open', 'Realized', 'Done', 'Cancelled', 'Rejected');

-- CreateTable
CREATE TABLE "sal_permit_request" (
    "id" SERIAL NOT NULL,
    "request_no" TEXT NOT NULL,
    "request_date" DATE NOT NULL,
    "status" "PermitRequestStatus" NOT NULL DEFAULT 'Draft',
    "customer_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "term_id" INTEGER NOT NULL,
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "price_mode" "PriceMode" NOT NULL,
    "ppn_rate" DECIMAL(9,4),
    "ppn_dpp_other_numerator" INTEGER,
    "ppn_dpp_other_denominator" INTEGER,
    "withholding_tax_id" INTEGER,
    "withholding_rate" DECIMAL(9,4),
    "po_no" TEXT,
    "po_date" DATE,
    "salesperson" TEXT,
    "product_name" TEXT NOT NULL,
    "note" TEXT,
    "estimate_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "estimate_dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "estimate_dpp_other" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "estimate_ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "estimate_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "realization_no" TEXT,
    "realization_date" DATE,
    "realization_note" TEXT,
    "realized_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "realized_dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "realized_dpp_other" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "realized_ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "realized_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cost_paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sal_permit_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sal_permit_request_line" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "permit_type_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "estimate_price" DECIMAL(18,2) NOT NULL,
    "realized_price" DECIMAL(18,2),
    "is_added" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sal_permit_request_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sal_permit_request_request_no_key" ON "sal_permit_request"("request_no");

-- CreateIndex
CREATE UNIQUE INDEX "sal_permit_request_realization_no_key" ON "sal_permit_request"("realization_no");

-- CreateIndex
CREATE INDEX "sal_permit_request_customer_id_idx" ON "sal_permit_request"("customer_id");

-- CreateIndex
CREATE INDEX "sal_permit_request_status_request_date_idx" ON "sal_permit_request"("status", "request_date");

-- CreateIndex
CREATE UNIQUE INDEX "sal_permit_request_line_request_id_line_no_key" ON "sal_permit_request_line"("request_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "sal_permit_request_line_request_id_permit_type_id_key" ON "sal_permit_request_line"("request_id", "permit_type_id");

-- AddForeignKey
ALTER TABLE "sal_permit_request" ADD CONSTRAINT "sal_permit_request_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_permit_request" ADD CONSTRAINT "sal_permit_request_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "m_partner_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_permit_request" ADD CONSTRAINT "sal_permit_request_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "ref_payment_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_permit_request" ADD CONSTRAINT "sal_permit_request_withholding_tax_id_fkey" FOREIGN KEY ("withholding_tax_id") REFERENCES "ref_withholding_tax"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_permit_request_line" ADD CONSTRAINT "sal_permit_request_line_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "sal_permit_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_permit_request_line" ADD CONSTRAINT "sal_permit_request_line_permit_type_id_fkey" FOREIGN KEY ("permit_type_id") REFERENCES "ref_permit_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
