-- The Perintah Produksi plans an Item Target and a quantity, and the BoMs give its
-- material requirements (P165). It names no lot and no warehouse any more: the
-- Logistik BSTB picks the lots. Perintah saved before keep their route; their
-- planned lots go, and their Qty Target starts at 0 (development data only).

-- DropForeignKey
ALTER TABLE "prd_order" DROP CONSTRAINT "prd_order_warehouse_id_fkey";

-- DropForeignKey
ALTER TABLE "prd_order_lot" DROP CONSTRAINT "prd_order_lot_item_id_fkey";

-- DropForeignKey
ALTER TABLE "prd_order_lot" DROP CONSTRAINT "prd_order_lot_lot_id_fkey";

-- DropForeignKey
ALTER TABLE "prd_order_lot" DROP CONSTRAINT "prd_order_lot_order_id_fkey";

-- DropForeignKey
ALTER TABLE "prd_order_lot" DROP CONSTRAINT "prd_order_lot_uom_id_fkey";

-- AlterTable
ALTER TABLE "prd_order" DROP COLUMN "warehouse_id",
ADD COLUMN     "target_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "prd_order" ALTER COLUMN "target_qty" DROP DEFAULT;

-- DropTable
DROP TABLE "prd_order_lot";

-- CreateTable
CREATE TABLE "prd_order_requirement" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "step_no" INTEGER,
    "workstation_id" INTEGER,
    "bom_id" INTEGER NOT NULL,

    CONSTRAINT "prd_order_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prd_order_requirement_item_id_idx" ON "prd_order_requirement"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_order_requirement_order_id_line_no_key" ON "prd_order_requirement"("order_id", "line_no");

-- AddForeignKey
ALTER TABLE "prd_order_requirement" ADD CONSTRAINT "prd_order_requirement_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "prd_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_requirement" ADD CONSTRAINT "prd_order_requirement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_requirement" ADD CONSTRAINT "prd_order_requirement_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_requirement" ADD CONSTRAINT "prd_order_requirement_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_order_requirement" ADD CONSTRAINT "prd_order_requirement_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "prd_bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

