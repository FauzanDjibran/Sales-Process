-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('Draft', 'Confirmed', 'Cancelled');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('Percent', 'Amount');

-- CreateTable
CREATE TABLE "sal_order" (
    "id" SERIAL NOT NULL,
    "order_no" TEXT NOT NULL,
    "order_date" DATE NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'Draft',
    "customer_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "term_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "price_mode" "PriceMode" NOT NULL,
    "po_no" TEXT,
    "po_date" DATE,
    "requested_date" DATE NOT NULL,
    "salesperson" TEXT,
    "note" TEXT,
    "gross_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "copied_from_id" INTEGER,
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
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "uom_factor" DECIMAL(18,4) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "discount_type" "DiscountType",
    "discount_value" DECIMAL(18,4),
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "dpp_amount" DECIMAL(18,2) NOT NULL,
    "ppn_amount" DECIMAL(18,2) NOT NULL,
    "withholding_tax_id" INTEGER,
    "withholding_rate" DECIMAL(9,4),
    "note" TEXT,

    CONSTRAINT "sal_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sal_order_order_no_key" ON "sal_order"("order_no");

-- CreateIndex
CREATE INDEX "sal_order_customer_id_idx" ON "sal_order"("customer_id");

-- CreateIndex
CREATE INDEX "sal_order_status_order_date_idx" ON "sal_order"("status", "order_date");

-- CreateIndex
CREATE INDEX "sal_order_line_item_id_idx" ON "sal_order_line"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sal_order_line_order_id_line_no_key" ON "sal_order_line"("order_id", "line_no");

-- AddForeignKey
ALTER TABLE "sal_order" ADD CONSTRAINT "sal_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order" ADD CONSTRAINT "sal_order_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "m_partner_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order" ADD CONSTRAINT "sal_order_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "ref_payment_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order" ADD CONSTRAINT "sal_order_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order" ADD CONSTRAINT "sal_order_copied_from_id_fkey" FOREIGN KEY ("copied_from_id") REFERENCES "sal_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order_line" ADD CONSTRAINT "sal_order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sal_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order_line" ADD CONSTRAINT "sal_order_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order_line" ADD CONSTRAINT "sal_order_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_order_line" ADD CONSTRAINT "sal_order_line_withholding_tax_id_fkey" FOREIGN KEY ("withholding_tax_id") REFERENCES "ref_withholding_tax"("id") ON DELETE SET NULL ON UPDATE CASCADE;
