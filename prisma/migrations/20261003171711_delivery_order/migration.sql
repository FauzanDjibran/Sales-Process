-- CreateEnum
CREATE TYPE "DeliveryOrderStatus" AS ENUM ('Draft', 'Issued', 'Closed', 'Cancelled');

-- CreateTable
CREATE TABLE "sal_delivery_order" (
    "id" SERIAL NOT NULL,
    "do_no" TEXT NOT NULL,
    "do_date" DATE NOT NULL,
    "delivery_date" DATE NOT NULL,
    "status" "DeliveryOrderStatus" NOT NULL DEFAULT 'Draft',
    "customer_order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sal_delivery_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sal_delivery_order_line" (
    "id" SERIAL NOT NULL,
    "delivery_order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "sales_order_line_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "note" TEXT,

    CONSTRAINT "sal_delivery_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sal_delivery_order_do_no_key" ON "sal_delivery_order"("do_no");

-- CreateIndex
CREATE INDEX "sal_delivery_order_customer_order_id_idx" ON "sal_delivery_order"("customer_order_id");

-- CreateIndex
CREATE INDEX "sal_delivery_order_status_delivery_date_idx" ON "sal_delivery_order"("status", "delivery_date");

-- CreateIndex
CREATE INDEX "sal_delivery_order_line_sales_order_line_id_idx" ON "sal_delivery_order_line"("sales_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "sal_delivery_order_line_delivery_order_id_line_no_key" ON "sal_delivery_order_line"("delivery_order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "sal_delivery_order_line_delivery_order_id_sales_order_line__key" ON "sal_delivery_order_line"("delivery_order_id", "sales_order_line_id");

-- AddForeignKey
ALTER TABLE "sal_delivery_order" ADD CONSTRAINT "sal_delivery_order_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "sal_customer_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_order" ADD CONSTRAINT "sal_delivery_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_order" ADD CONSTRAINT "sal_delivery_order_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_order" ADD CONSTRAINT "sal_delivery_order_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "m_partner_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_order_line" ADD CONSTRAINT "sal_delivery_order_line_delivery_order_id_fkey" FOREIGN KEY ("delivery_order_id") REFERENCES "sal_delivery_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_delivery_order_line" ADD CONSTRAINT "sal_delivery_order_line_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sal_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
