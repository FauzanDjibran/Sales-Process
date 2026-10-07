-- DropIndex
DROP INDEX "log_delivery_note_lot_delivery_note_line_id_lot_id_key";

-- DropIndex
DROP INDEX "log_stock_balance_warehouse_id_tracking_id_stock_status_id_key";

-- AlterTable
ALTER TABLE "log_delivery_note_lot" ADD COLUMN     "location_id" INTEGER;

-- AlterTable
ALTER TABLE "log_receipt_note_lot" ADD COLUMN     "location_id" INTEGER;

-- AlterTable
ALTER TABLE "log_stock_balance" ADD COLUMN     "location_id" INTEGER;

-- AlterTable
ALTER TABLE "log_stock_ledger" ADD COLUMN     "location_id" INTEGER;

-- AlterTable
ALTER TABLE "ref_warehouse" ADD COLUMN     "use_location" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ref_warehouse_location" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "location_code" TEXT NOT NULL,
    "location_label" TEXT NOT NULL,
    "location_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_warehouse_location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ref_warehouse_location_location_code_key" ON "ref_warehouse_location"("location_code");

-- CreateIndex
CREATE UNIQUE INDEX "ref_warehouse_location_warehouse_id_location_label_key" ON "ref_warehouse_location"("warehouse_id", "location_label");

-- AddForeignKey
ALTER TABLE "ref_warehouse_location" ADD CONSTRAINT "ref_warehouse_location_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_ledger" ADD CONSTRAINT "log_stock_ledger_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "ref_warehouse_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_balance" ADD CONSTRAINT "log_stock_balance_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "ref_warehouse_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The two keys the schema declares with @@unique, written by hand because
-- Prisma cannot express NULLS NOT DISTINCT. A warehouse without
-- locations keeps its buckets with location_id null, and two such rows of one
-- lot and status must still be one bucket; a pick is a lot in a location, once
-- per line. inventory.ts's INSERT ... ON CONFLICT uses the bucket key as its
-- arbiter.
CREATE UNIQUE INDEX "log_stock_balance_bucket_key" ON "log_stock_balance" ("warehouse_id", "location_id", "tracking_id", "stock_status_id") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "log_delivery_note_lot_pick_key" ON "log_delivery_note_lot" ("delivery_note_line_id", "lot_id", "location_id") NULLS NOT DISTINCT;
