-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('Draft', 'Issued', 'Cancelled');

-- CreateEnum
CREATE TYPE "AdvanceAmountType" AS ENUM ('Percent', 'Amount');

-- CreateTable
CREATE TABLE "sal_advance" (
    "id" SERIAL NOT NULL,
    "advance_no" TEXT NOT NULL,
    "advance_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'Draft',
    "order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "cash_bank_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "price_mode" "PriceMode" NOT NULL,
    "is_taxable" BOOLEAN NOT NULL,
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

    CONSTRAINT "sal_advance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sal_advance_advance_no_key" ON "sal_advance"("advance_no");

-- CreateIndex
CREATE INDEX "sal_advance_order_id_idx" ON "sal_advance"("order_id");

-- CreateIndex
CREATE INDEX "sal_advance_customer_id_idx" ON "sal_advance"("customer_id");

-- CreateIndex
CREATE INDEX "sal_advance_status_advance_date_idx" ON "sal_advance"("status", "advance_date");

-- AddForeignKey
ALTER TABLE "sal_advance" ADD CONSTRAINT "sal_advance_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sal_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_advance" ADD CONSTRAINT "sal_advance_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_advance" ADD CONSTRAINT "sal_advance_cash_bank_id_fkey" FOREIGN KEY ("cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
