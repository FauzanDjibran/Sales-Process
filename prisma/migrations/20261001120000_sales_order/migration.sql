-- The Sales Order (Claude-ERP.md P79): a dated slice of an Open Customer
-- Order's quantity, released to PPIC. Quantity and a delivery date only; the
-- price, the tax and the money stay with the Customer Order. Its lines name
-- the Customer Order line they draw from, whose item and unit they take.

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('Draft', 'Submitted', 'PreSO', 'Open', 'Closed', 'Cancelled', 'Rejected');

-- CreateTable
CREATE TABLE "sal_order" (
    "id" SERIAL NOT NULL,
    "order_no" TEXT NOT NULL,
    "order_date" DATE NOT NULL,
    "delivery_date" DATE NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'Draft',
    "customer_order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sal_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sal_order_line" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "customer_order_line_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "note" TEXT,

    CONSTRAINT "sal_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sal_order_order_no_key" ON "sal_order"("order_no");

-- CreateIndex
CREATE INDEX "sal_order_customer_order_id_idx" ON "sal_order"("customer_order_id");

-- CreateIndex
CREATE INDEX "sal_order_status_delivery_date_idx" ON "sal_order"("status", "delivery_date");

-- CreateIndex
CREATE INDEX "sal_order_line_customer_order_line_id_idx" ON "sal_order_line"("customer_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "sal_order_line_order_id_line_no_key" ON "sal_order_line"("order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "sal_order_line_order_id_customer_order_line_id_key" ON "sal_order_line"("order_id", "customer_order_line_id");

-- AddForeignKey
ALTER TABLE "sal_order" ADD CONSTRAINT "sal_order_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "sal_customer_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order" ADD CONSTRAINT "sal_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order" ADD CONSTRAINT "sal_order_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "m_partner_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order_line" ADD CONSTRAINT "sal_order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sal_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order_line" ADD CONSTRAINT "sal_order_line_customer_order_line_id_fkey" FOREIGN KEY ("customer_order_line_id") REFERENCES "sal_customer_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

