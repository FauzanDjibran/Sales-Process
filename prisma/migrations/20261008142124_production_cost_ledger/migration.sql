-- CreateEnum
CREATE TYPE "ProductionCostKind" AS ENUM ('In', 'Absorbed', 'CarriedOut', 'CarriedIn', 'ExpensedToPL');

-- CreateEnum
CREATE TYPE "ProductionCostBillStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "prd_cost_ledger" (
    "id" SERIAL NOT NULL,
    "ledger_no" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "posting_date" DATE NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "element_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "kind" "ProductionCostKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_cost_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_bill" (
    "id" SERIAL NOT NULL,
    "bill_no" TEXT NOT NULL,
    "bill_date" DATE NOT NULL,
    "contra_account_id" INTEGER NOT NULL,
    "partner_id" INTEGER,
    "supplier_ref" TEXT,
    "due_date" DATE,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "status" "ProductionCostBillStatus" NOT NULL DEFAULT 'Draft',
    "cancel_reason" TEXT,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "is_payable" BOOLEAN NOT NULL DEFAULT false,
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
    "element_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "prd_cost_bill_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prd_cost_ledger_posting_date_idx" ON "prd_cost_ledger"("posting_date");

-- CreateIndex
CREATE INDEX "prd_cost_ledger_element_id_posting_date_idx" ON "prd_cost_ledger"("element_id", "posting_date");

-- CreateIndex
CREATE INDEX "prd_cost_ledger_source_doc_type_id_source_doc_id_idx" ON "prd_cost_ledger"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_ledger_ledger_no_line_no_key" ON "prd_cost_ledger"("ledger_no", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_bill_bill_no_key" ON "prd_cost_bill"("bill_no");

-- CreateIndex
CREATE INDEX "prd_cost_bill_status_idx" ON "prd_cost_bill"("status");

-- CreateIndex
CREATE INDEX "prd_cost_bill_partner_id_idx" ON "prd_cost_bill"("partner_id");

-- CreateIndex
CREATE INDEX "prd_cost_bill_line_bill_id_idx" ON "prd_cost_bill_line"("bill_id");

-- AddForeignKey
ALTER TABLE "prd_cost_ledger" ADD CONSTRAINT "prd_cost_ledger_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "acc_production_cost_element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_ledger" ADD CONSTRAINT "prd_cost_ledger_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_bill" ADD CONSTRAINT "prd_cost_bill_contra_account_id_fkey" FOREIGN KEY ("contra_account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_bill" ADD CONSTRAINT "prd_cost_bill_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_bill_line" ADD CONSTRAINT "prd_cost_bill_line_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "prd_cost_bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_bill_line" ADD CONSTRAINT "prd_cost_bill_line_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "acc_production_cost_element"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
