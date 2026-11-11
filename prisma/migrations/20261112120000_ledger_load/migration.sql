-- Stage 5.4 of production_app_plan.md: the production ledger written with less
-- asking per row. A counter per document series, and a BRIN index for date
-- ranges over the ledger (hasProductionMovement and the reports).

-- CreateTable
CREATE TABLE "sys_number_counter" (
    "id" SERIAL NOT NULL,
    "series" TEXT NOT NULL,
    "last_no" INTEGER NOT NULL,

    CONSTRAINT "sys_number_counter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_number_counter_series_key" ON "sys_number_counter"("series");

-- CreateIndex
CREATE INDEX "prd_ledger_posting_date_idx" ON "prd_ledger" USING BRIN ("posting_date");

