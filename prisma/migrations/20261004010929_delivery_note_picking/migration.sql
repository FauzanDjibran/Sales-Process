-- AlterTable
ALTER TABLE "tmp_stock_movement" ADD COLUMN     "lot_id" INTEGER,
ADD COLUMN     "lot_no" TEXT;

-- CreateTable
CREATE TABLE "sal_delivery_note_pick" (
    "id" SERIAL NOT NULL,
    "delivery_note_line_id" INTEGER NOT NULL,
    "pick_no" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "lot_no" TEXT NOT NULL,
    "expiry_date" DATE,
    "qty" DECIMAL(18,4) NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sal_delivery_note_pick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tmp_stock_lot" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "lot_no" TEXT NOT NULL,
    "expiry_date" DATE,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tmp_stock_lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sal_delivery_note_pick_lot_id_idx" ON "sal_delivery_note_pick"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "sal_delivery_note_pick_delivery_note_line_id_pick_no_key" ON "sal_delivery_note_pick"("delivery_note_line_id", "pick_no");

-- CreateIndex
CREATE UNIQUE INDEX "sal_delivery_note_pick_delivery_note_line_id_lot_id_key" ON "sal_delivery_note_pick"("delivery_note_line_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "tmp_stock_lot_item_id_warehouse_id_lot_no_key" ON "tmp_stock_lot"("item_id", "warehouse_id", "lot_no");

-- AddForeignKey
ALTER TABLE "sal_delivery_note_pick" ADD CONSTRAINT "sal_delivery_note_pick_delivery_note_line_id_fkey" FOREIGN KEY ("delivery_note_line_id") REFERENCES "sal_delivery_note_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tmp_stock_lot" ADD CONSTRAINT "tmp_stock_lot_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tmp_stock_lot" ADD CONSTRAINT "tmp_stock_lot_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
