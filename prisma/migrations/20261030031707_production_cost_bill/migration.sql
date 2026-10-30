-- CreateEnum
CREATE TYPE "ProductionCostBillStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "prd_cost_bill" (
    "id" SERIAL NOT NULL,
    "bill_no" TEXT NOT NULL,
    "bill_date" DATE NOT NULL,
    "partner_id" INTEGER,
    "supplier_ref" TEXT,
    "due_date" DATE,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "status" "ProductionCostBillStatus" NOT NULL DEFAULT 'Draft',
    "cancel_reason" TEXT,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payable_account_id" INTEGER,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_cost_bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_bill_line" (
    "id" SERIAL NOT NULL,
    "bill_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "cost_type_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "prd_cost_bill_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_bill_bill_no_key" ON "prd_cost_bill"("bill_no");

-- CreateIndex
CREATE INDEX "prd_cost_bill_status_idx" ON "prd_cost_bill"("status");

-- CreateIndex
CREATE INDEX "prd_cost_bill_partner_id_idx" ON "prd_cost_bill"("partner_id");

-- CreateIndex
CREATE INDEX "prd_cost_bill_line_bill_id_idx" ON "prd_cost_bill_line"("bill_id");

-- AddForeignKey
ALTER TABLE "prd_cost_bill" ADD CONSTRAINT "prd_cost_bill_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_bill" ADD CONSTRAINT "prd_cost_bill_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_bill_line" ADD CONSTRAINT "prd_cost_bill_line_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "prd_cost_bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_bill_line" ADD CONSTRAINT "prd_cost_bill_line_cost_type_id_fkey" FOREIGN KEY ("cost_type_id") REFERENCES "acc_cost_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A bill is never paid beyond its total (P132).
ALTER TABLE "prd_cost_bill" ADD CONSTRAINT "prd_cost_bill_paid_within_total" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
