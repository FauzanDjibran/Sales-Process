-- P124: the Purchase Order (Purchasing-Concept.md B9–B16) and its link to the request lines.

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('Draft', 'Submitted', 'Open', 'Closed', 'Cancelled', 'Rejected');

-- CreateTable
CREATE TABLE "pur_order" (
    "id" SERIAL NOT NULL,
    "order_no" TEXT NOT NULL,
    "order_date" DATE NOT NULL,
    "item_type" "ItemType" NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'Draft',
    "supplier_id" INTEGER NOT NULL,
    "term_id" INTEGER NOT NULL,
    "delivery_date" DATE NOT NULL,
    "warehouse_id" INTEGER,
    "quotation_no" TEXT,
    "is_taxable" BOOLEAN NOT NULL DEFAULT true,
    "price_mode" "PriceMode" NOT NULL,
    "ppn_rate" DECIMAL(9,4),
    "ppn_dpp_other_numerator" INTEGER,
    "ppn_dpp_other_denominator" INTEGER,
    "note" TEXT,
    "gross_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pur_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pur_order_line" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "uom_factor" DECIMAL(18,4) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "discount_type" "DiscountType",
    "discount_value" DECIMAL(18,4),
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "dpp_amount" DECIMAL(18,2) NOT NULL,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL,
    "withholding_tax_id" INTEGER,
    "withholding_rate" DECIMAL(9,4),
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "pur_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pur_order_line_request" (
    "id" SERIAL NOT NULL,
    "order_line_id" INTEGER NOT NULL,
    "request_line_id" INTEGER NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "pur_order_line_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pur_order_order_no_key" ON "pur_order"("order_no");

-- CreateIndex
CREATE INDEX "pur_order_supplier_id_idx" ON "pur_order"("supplier_id");

-- CreateIndex
CREATE INDEX "pur_order_item_type_status_idx" ON "pur_order"("item_type", "status");

-- CreateIndex
CREATE INDEX "pur_order_line_item_id_idx" ON "pur_order_line"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "pur_order_line_order_id_line_no_key" ON "pur_order_line"("order_id", "line_no");

-- CreateIndex
CREATE INDEX "pur_order_line_request_request_line_id_idx" ON "pur_order_line_request"("request_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "pur_order_line_request_order_line_id_request_line_id_key" ON "pur_order_line_request"("order_line_id", "request_line_id");

-- AddForeignKey
ALTER TABLE "pur_order" ADD CONSTRAINT "pur_order_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_order" ADD CONSTRAINT "pur_order_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "ref_payment_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_order" ADD CONSTRAINT "pur_order_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_order_line" ADD CONSTRAINT "pur_order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pur_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_order_line" ADD CONSTRAINT "pur_order_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_order_line" ADD CONSTRAINT "pur_order_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_order_line" ADD CONSTRAINT "pur_order_line_withholding_tax_id_fkey" FOREIGN KEY ("withholding_tax_id") REFERENCES "ref_withholding_tax"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_order_line_request" ADD CONSTRAINT "pur_order_line_request_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "pur_order_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_order_line_request" ADD CONSTRAINT "pur_order_line_request_request_line_id_fkey" FOREIGN KEY ("request_line_id") REFERENCES "pur_request_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

