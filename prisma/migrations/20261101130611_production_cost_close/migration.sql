-- AlterTable
ALTER TABLE "acc_fiscal_period" ADD COLUMN     "production_costed_at" TIMESTAMPTZ(6),
ADD COLUMN     "production_costed_by" INTEGER;

-- CreateTable
CREATE TABLE "acc_fiscal_period_lock" (
    "id" SERIAL NOT NULL,
    "period_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,

    CONSTRAINT "acc_fiscal_period_lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_close" (
    "id" SERIAL NOT NULL,
    "period_id" INTEGER NOT NULL,
    "close_date" DATE NOT NULL,
    "pool_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_cost_close_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_close_pool" (
    "id" SERIAL NOT NULL,
    "close_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "prd_cost_close_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_close_share" (
    "id" SERIAL NOT NULL,
    "close_id" INTEGER NOT NULL,
    "execution_id" INTEGER NOT NULL,
    "execution_no" TEXT NOT NULL,
    "driver" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "prd_cost_close_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_close_dest" (
    "id" SERIAL NOT NULL,
    "close_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "item_id" INTEGER,
    "bucket_id" INTEGER,
    "account_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "prd_cost_close_dest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_close_item" (
    "id" SERIAL NOT NULL,
    "close_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "opening_qty" DECIMAL(18,6) NOT NULL,
    "inflow_qty" DECIMAL(18,6) NOT NULL,
    "outflow_qty" DECIMAL(18,6) NOT NULL,
    "ending_qty" DECIMAL(18,6) NOT NULL,
    "value_before" DECIMAL(18,2) NOT NULL,
    "hpp_amount" DECIMAL(18,2) NOT NULL,
    "stock_amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "prd_cost_close_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "acc_fiscal_period_lock_period_id_account_id_key" ON "acc_fiscal_period_lock"("period_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_close_period_id_key" ON "prd_cost_close"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_close_pool_close_id_account_id_key" ON "prd_cost_close_pool"("close_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_close_share_close_id_execution_id_key" ON "prd_cost_close_share"("close_id", "execution_id");

-- CreateIndex
CREATE INDEX "prd_cost_close_dest_close_id_kind_idx" ON "prd_cost_close_dest"("close_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_close_item_close_id_item_id_key" ON "prd_cost_close_item"("close_id", "item_id");

-- AddForeignKey
ALTER TABLE "acc_fiscal_period_lock" ADD CONSTRAINT "acc_fiscal_period_lock_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "acc_fiscal_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_close_pool" ADD CONSTRAINT "prd_cost_close_pool_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "prd_cost_close"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_close_share" ADD CONSTRAINT "prd_cost_close_share_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "prd_cost_close"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_close_dest" ADD CONSTRAINT "prd_cost_close_dest_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "prd_cost_close"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_close_item" ADD CONSTRAINT "prd_cost_close_item_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "prd_cost_close"("id") ON DELETE CASCADE ON UPDATE CASCADE;
