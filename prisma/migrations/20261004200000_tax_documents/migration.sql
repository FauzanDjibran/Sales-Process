
-- CreateEnum
CREATE TYPE "TaxFakturKind" AS ENUM ('Advance', 'Settlement', 'Normal');

-- CreateEnum
CREATE TYPE "TaxFakturStatus" AS ENUM ('Awaiting', 'Reported');

-- CreateEnum
CREATE TYPE "TaxSlipStatus" AS ENUM ('Awaiting', 'Received');

-- CreateTable
CREATE TABLE "tax_faktur" (
    "id" SERIAL NOT NULL,
    "faktur_no" TEXT NOT NULL,
    "kind" "TaxFakturKind" NOT NULL,
    "status" "TaxFakturStatus" NOT NULL DEFAULT 'Awaiting',
    "tax_date" DATE NOT NULL,
    "deadline" DATE NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "buyer_tax_type" TEXT,
    "buyer_tax_id" TEXT,
    "buyer_name" TEXT NOT NULL,
    "buyer_address" TEXT NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "ref_doc_type_id" INTEGER,
    "ref_doc_id" INTEGER,
    "ref_no" TEXT,
    "ar_item_id" INTEGER,
    "customer_order_id" INTEGER NOT NULL,
    "description" TEXT,
    "ppn_rate" DECIMAL(9,4) NOT NULL,
    "ppn_dpp_other_numerator" INTEGER NOT NULL,
    "ppn_dpp_other_denominator" INTEGER NOT NULL,
    "gross_dpp" DECIMAL(18,2) NOT NULL,
    "advance_dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp" DECIMAL(18,2) NOT NULL,
    "dpp_other" DECIMAL(18,2) NOT NULL,
    "ppn" DECIMAL(18,2) NOT NULL,
    "nsfp" TEXT,
    "reported_date" DATE,
    "reported_by" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_faktur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_faktur_line" (
    "id" SERIAL NOT NULL,
    "faktur_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "item_label" TEXT,
    "qty" DECIMAL(18,4),
    "uom_label" TEXT,
    "price" DECIMAL(18,2),
    "gross_dpp" DECIMAL(18,2) NOT NULL,
    "advance_dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp" DECIMAL(18,2) NOT NULL,
    "dpp_other" DECIMAL(18,2) NOT NULL,
    "ppn" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "tax_faktur_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_faktur_ref" (
    "id" SERIAL NOT NULL,
    "faktur_id" INTEGER NOT NULL,
    "ref_faktur_id" INTEGER NOT NULL,
    "dpp_deducted" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "tax_faktur_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_withholding_slip" (
    "id" SERIAL NOT NULL,
    "slip_no" TEXT NOT NULL,
    "status" "TaxSlipStatus" NOT NULL DEFAULT 'Awaiting',
    "withheld_date" DATE NOT NULL,
    "tax_period" TEXT NOT NULL,
    "expected_date" DATE NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "withholder_tax_type" TEXT,
    "withholder_tax_id" TEXT,
    "withholder_name" TEXT NOT NULL,
    "receipt_line_wht_id" INTEGER NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "doc_type_id" INTEGER NOT NULL,
    "doc_id" INTEGER NOT NULL,
    "doc_no" TEXT NOT NULL,
    "withholding_tax_id" INTEGER NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "slip_number" TEXT,
    "slip_date" DATE,
    "received_by" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_withholding_slip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_faktur_faktur_no_key" ON "tax_faktur"("faktur_no");

-- CreateIndex
CREATE UNIQUE INDEX "tax_faktur_nsfp_key" ON "tax_faktur"("nsfp");

-- CreateIndex
CREATE INDEX "tax_faktur_status_tax_date_idx" ON "tax_faktur"("status", "tax_date");

-- CreateIndex
CREATE INDEX "tax_faktur_source_doc_type_id_source_doc_id_idx" ON "tax_faktur"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE INDEX "tax_faktur_ar_item_id_idx" ON "tax_faktur"("ar_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_faktur_line_faktur_id_line_no_key" ON "tax_faktur_line"("faktur_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "tax_faktur_ref_faktur_id_ref_faktur_id_key" ON "tax_faktur_ref"("faktur_id", "ref_faktur_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_withholding_slip_slip_no_key" ON "tax_withholding_slip"("slip_no");

-- CreateIndex
CREATE UNIQUE INDEX "tax_withholding_slip_receipt_line_wht_id_key" ON "tax_withholding_slip"("receipt_line_wht_id");

-- CreateIndex
CREATE INDEX "tax_withholding_slip_status_withheld_date_idx" ON "tax_withholding_slip"("status", "withheld_date");

-- CreateIndex
CREATE INDEX "tax_withholding_slip_receipt_id_idx" ON "tax_withholding_slip"("receipt_id");

-- CreateIndex
CREATE INDEX "tax_withholding_slip_doc_type_id_doc_id_idx" ON "tax_withholding_slip"("doc_type_id", "doc_id");

-- AddForeignKey
ALTER TABLE "tax_faktur" ADD CONSTRAINT "tax_faktur_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_faktur_line" ADD CONSTRAINT "tax_faktur_line_faktur_id_fkey" FOREIGN KEY ("faktur_id") REFERENCES "tax_faktur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_faktur_ref" ADD CONSTRAINT "tax_faktur_ref_faktur_id_fkey" FOREIGN KEY ("faktur_id") REFERENCES "tax_faktur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_faktur_ref" ADD CONSTRAINT "tax_faktur_ref_ref_faktur_id_fkey" FOREIGN KEY ("ref_faktur_id") REFERENCES "tax_faktur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_withholding_slip" ADD CONSTRAINT "tax_withholding_slip_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_withholding_slip" ADD CONSTRAINT "tax_withholding_slip_withholding_tax_id_fkey" FOREIGN KEY ("withholding_tax_id") REFERENCES "ref_withholding_tax"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

