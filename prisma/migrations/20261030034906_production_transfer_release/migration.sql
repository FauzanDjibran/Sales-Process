-- CreateTable
CREATE TABLE "prd_transfer" (
    "id" SERIAL NOT NULL,
    "transfer_no" TEXT NOT NULL,
    "transfer_date" DATE NOT NULL,
    "from_workstation_id" INTEGER NOT NULL,
    "to_workstation_id" INTEGER NOT NULL,
    "status" "ProductionDocStatus" NOT NULL DEFAULT 'Draft',
    "note" TEXT,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_transfer_line" (
    "id" SERIAL NOT NULL,
    "transfer_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "to_bucket_id" INTEGER,
    "lot_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "prd_transfer_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_release" (
    "id" SERIAL NOT NULL,
    "release_no" TEXT NOT NULL,
    "release_date" DATE NOT NULL,
    "purpose" TEXT NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER,
    "location_id" INTEGER,
    "status" "ProductionDocStatus" NOT NULL DEFAULT 'Draft',
    "scrap_reason" TEXT,
    "note" TEXT,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_release_line" (
    "id" SERIAL NOT NULL,
    "release_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "prd_release_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_transfer_transfer_no_key" ON "prd_transfer"("transfer_no");

-- CreateIndex
CREATE INDEX "prd_transfer_status_transfer_date_idx" ON "prd_transfer"("status", "transfer_date");

-- CreateIndex
CREATE INDEX "prd_transfer_line_bucket_id_idx" ON "prd_transfer_line"("bucket_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_transfer_line_transfer_id_line_no_key" ON "prd_transfer_line"("transfer_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "prd_release_release_no_key" ON "prd_release"("release_no");

-- CreateIndex
CREATE INDEX "prd_release_purpose_status_idx" ON "prd_release"("purpose", "status");

-- CreateIndex
CREATE INDEX "prd_release_status_release_date_idx" ON "prd_release"("status", "release_date");

-- CreateIndex
CREATE INDEX "prd_release_line_bucket_id_idx" ON "prd_release_line"("bucket_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_release_line_release_id_line_no_key" ON "prd_release_line"("release_id", "line_no");

-- AddForeignKey
ALTER TABLE "prd_transfer" ADD CONSTRAINT "prd_transfer_from_workstation_id_fkey" FOREIGN KEY ("from_workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_transfer" ADD CONSTRAINT "prd_transfer_to_workstation_id_fkey" FOREIGN KEY ("to_workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_transfer_line" ADD CONSTRAINT "prd_transfer_line_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "prd_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_transfer_line" ADD CONSTRAINT "prd_transfer_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_release" ADD CONSTRAINT "prd_release_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_release" ADD CONSTRAINT "prd_release_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_release_line" ADD CONSTRAINT "prd_release_line_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "prd_release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_release_line" ADD CONSTRAINT "prd_release_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R7: a transfer moves goods to another workstation.
ALTER TABLE "prd_transfer" ADD CONSTRAINT "prd_transfer_other_station" CHECK ("from_workstation_id" <> "to_workstation_id");

-- R8: into a warehouse, or written off with a reason.
ALTER TABLE "prd_release" ADD CONSTRAINT "prd_release_purpose" CHECK (("purpose" = 'to_stock' AND "warehouse_id" IS NOT NULL) OR ("purpose" = 'scrap' AND "warehouse_id" IS NULL AND "location_id" IS NULL));
