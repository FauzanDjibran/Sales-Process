
-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- AlterTable
ALTER TABLE "sal_customer_order_line" ADD COLUMN     "delivered_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sal_invoice" (
    "id" SERIAL NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "tax_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'Draft',
    "customer_order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "price_mode" "PriceMode" NOT NULL,
    "is_taxable" BOOLEAN NOT NULL,
    "ppn_rate" DECIMAL(9,4),
    "ppn_dpp_other_numerator" INTEGER,
    "ppn_dpp_other_denominator" INTEGER,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advance_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_invoice_no" TEXT,
    "journal_id" INTEGER,
    "ar_item_id" INTEGER,
    "note" TEXT,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sal_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sal_invoice_line" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "delivery_note_line_id" INTEGER NOT NULL,
    "customer_order_line_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dpp_amount" DECIMAL(18,2) NOT NULL,
    "advance_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_dpp_amount" DECIMAL(18,2) NOT NULL,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "withholding_tax_id" INTEGER,
    "withholding_rate" DECIMAL(9,4),

    CONSTRAINT "sal_invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sal_invoice_advance_deduction" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "ar_item_id" INTEGER NOT NULL,
    "ar_item_no" TEXT NOT NULL,
    "dpp_used" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sal_invoice_advance_deduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sal_invoice_invoice_no_key" ON "sal_invoice"("invoice_no");

-- CreateIndex
CREATE INDEX "sal_invoice_customer_order_id_idx" ON "sal_invoice"("customer_order_id");

-- CreateIndex
CREATE INDEX "sal_invoice_status_invoice_date_idx" ON "sal_invoice"("status", "invoice_date");

-- CreateIndex
CREATE INDEX "sal_invoice_line_delivery_note_line_id_idx" ON "sal_invoice_line"("delivery_note_line_id");

-- CreateIndex
CREATE INDEX "sal_invoice_line_customer_order_line_id_idx" ON "sal_invoice_line"("customer_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "sal_invoice_line_invoice_id_line_no_key" ON "sal_invoice_line"("invoice_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "sal_invoice_line_invoice_id_delivery_note_line_id_key" ON "sal_invoice_line"("invoice_id", "delivery_note_line_id");

-- CreateIndex
CREATE INDEX "sal_invoice_advance_deduction_ar_item_id_idx" ON "sal_invoice_advance_deduction"("ar_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sal_invoice_advance_deduction_invoice_id_ar_item_id_key" ON "sal_invoice_advance_deduction"("invoice_id", "ar_item_id");

-- AddForeignKey
ALTER TABLE "sal_invoice" ADD CONSTRAINT "sal_invoice_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "sal_customer_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_invoice" ADD CONSTRAINT "sal_invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_invoice" ADD CONSTRAINT "sal_invoice_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "m_partner_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_invoice" ADD CONSTRAINT "sal_invoice_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_invoice_line" ADD CONSTRAINT "sal_invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sal_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_invoice_line" ADD CONSTRAINT "sal_invoice_line_delivery_note_line_id_fkey" FOREIGN KEY ("delivery_note_line_id") REFERENCES "sal_delivery_note_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_invoice_line" ADD CONSTRAINT "sal_invoice_line_customer_order_line_id_fkey" FOREIGN KEY ("customer_order_line_id") REFERENCES "sal_customer_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_invoice_line" ADD CONSTRAINT "sal_invoice_line_withholding_tax_id_fkey" FOREIGN KEY ("withholding_tax_id") REFERENCES "ref_withholding_tax"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_invoice_advance_deduction" ADD CONSTRAINT "sal_invoice_advance_deduction_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sal_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- What each Customer Order line has delivered so far (U21): the sum of what
-- its Sales Order lines delivered, which posted Delivery Notes wrote.
UPDATE "sal_customer_order_line" c
SET "delivered_qty" = d.qty
FROM (
  SELECT "customer_order_line_id" AS id, SUM("delivered_qty") AS qty
  FROM "sal_order_line" GROUP BY "customer_order_line_id"
) d
WHERE d.id = c."id";
