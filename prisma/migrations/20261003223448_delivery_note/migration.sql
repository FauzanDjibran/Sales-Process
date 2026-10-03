-- CreateEnum
CREATE TYPE "DeliveryNoteStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- AlterTable
ALTER TABLE "sal_order_line" ADD COLUMN     "delivered_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sal_delivery_order_line" ADD COLUMN     "delivered_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sal_delivery_note" (
    "id" SERIAL NOT NULL,
    "dn_no" TEXT NOT NULL,
    "dn_date" DATE NOT NULL,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'Draft',
    "delivery_order_id" INTEGER NOT NULL,
    "customer_order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "vehicle_no" TEXT,
    "driver_name" TEXT,
    "note" TEXT,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sal_delivery_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sal_delivery_note_line" (
    "id" SERIAL NOT NULL,
    "delivery_note_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "delivery_order_line_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "sal_delivery_note_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tmp_item_cost" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tmp_item_cost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tmp_stock_movement" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "movement_date" DATE NOT NULL,
    "base_qty_out" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL,
    "cost_amount" DECIMAL(18,2) NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tmp_stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sal_delivery_note_dn_no_key" ON "sal_delivery_note"("dn_no");

-- CreateIndex
CREATE INDEX "sal_delivery_note_delivery_order_id_idx" ON "sal_delivery_note"("delivery_order_id");

-- CreateIndex
CREATE INDEX "sal_delivery_note_customer_order_id_idx" ON "sal_delivery_note"("customer_order_id");

-- CreateIndex
CREATE INDEX "sal_delivery_note_status_dn_date_idx" ON "sal_delivery_note"("status", "dn_date");

-- CreateIndex
CREATE INDEX "sal_delivery_note_line_delivery_order_line_id_idx" ON "sal_delivery_note_line"("delivery_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "sal_delivery_note_line_delivery_note_id_line_no_key" ON "sal_delivery_note_line"("delivery_note_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "sal_delivery_note_line_delivery_note_id_delivery_order_line_key" ON "sal_delivery_note_line"("delivery_note_id", "delivery_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "tmp_item_cost_item_id_key" ON "tmp_item_cost"("item_id");

-- CreateIndex
CREATE INDEX "tmp_stock_movement_item_id_warehouse_id_movement_date_idx" ON "tmp_stock_movement"("item_id", "warehouse_id", "movement_date");

-- CreateIndex
CREATE INDEX "tmp_stock_movement_source_doc_type_id_source_doc_id_idx" ON "tmp_stock_movement"("source_doc_type_id", "source_doc_id");

-- AddForeignKey
ALTER TABLE "sal_delivery_note" ADD CONSTRAINT "sal_delivery_note_delivery_order_id_fkey" FOREIGN KEY ("delivery_order_id") REFERENCES "sal_delivery_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_note" ADD CONSTRAINT "sal_delivery_note_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "sal_customer_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_note" ADD CONSTRAINT "sal_delivery_note_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_note" ADD CONSTRAINT "sal_delivery_note_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_note" ADD CONSTRAINT "sal_delivery_note_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "m_partner_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_note_line" ADD CONSTRAINT "sal_delivery_note_line_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "sal_delivery_note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_note_line" ADD CONSTRAINT "sal_delivery_note_line_delivery_order_line_id_fkey" FOREIGN KEY ("delivery_order_line_id") REFERENCES "sal_delivery_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tmp_item_cost" ADD CONSTRAINT "tmp_item_cost_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tmp_stock_movement" ADD CONSTRAINT "tmp_stock_movement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tmp_stock_movement" ADD CONSTRAINT "tmp_stock_movement_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

