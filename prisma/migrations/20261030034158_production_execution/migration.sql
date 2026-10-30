-- CreateEnum
CREATE TYPE "ProductionDocStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "prd_execution" (
    "id" SERIAL NOT NULL,
    "execution_no" TEXT NOT NULL,
    "execution_date" DATE NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "driver" DECIMAL(18,4) NOT NULL,
    "status" "ProductionDocStatus" NOT NULL DEFAULT 'Draft',
    "note" TEXT,
    "input_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_execution_input" (
    "id" SERIAL NOT NULL,
    "execution_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "prd_execution_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_execution_output" (
    "id" SERIAL NOT NULL,
    "execution_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "lot_no" TEXT,
    "expiry_date" DATE,
    "qty" DECIMAL(18,4) NOT NULL,
    "weight" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lot_id" INTEGER,
    "bucket_id" INTEGER,

    CONSTRAINT "prd_execution_output_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_execution_execution_no_key" ON "prd_execution"("execution_no");

-- CreateIndex
CREATE INDEX "prd_execution_status_execution_date_idx" ON "prd_execution"("status", "execution_date");

-- CreateIndex
CREATE INDEX "prd_execution_workstation_id_idx" ON "prd_execution"("workstation_id");

-- CreateIndex
CREATE INDEX "prd_execution_input_bucket_id_idx" ON "prd_execution_input"("bucket_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_execution_input_execution_id_line_no_key" ON "prd_execution_input"("execution_id", "line_no");

-- CreateIndex
CREATE INDEX "prd_execution_output_lot_id_idx" ON "prd_execution_output"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_execution_output_execution_id_line_no_key" ON "prd_execution_output"("execution_id", "line_no");

-- AddForeignKey
ALTER TABLE "prd_execution" ADD CONSTRAINT "prd_execution_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_execution_input" ADD CONSTRAINT "prd_execution_input_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "prd_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_execution_input" ADD CONSTRAINT "prd_execution_input_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_execution_output" ADD CONSTRAINT "prd_execution_output_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "prd_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_execution_output" ADD CONSTRAINT "prd_execution_output_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R11: every execution carries a Driver above 0.
ALTER TABLE "prd_execution" ADD CONSTRAINT "prd_execution_driver_positive" CHECK ("driver" > 0);
