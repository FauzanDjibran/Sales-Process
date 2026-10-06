-- P123: the Purchase Request (Purchasing-Concept.md B6–B8), the first purchasing document.

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('Draft', 'Open', 'Closed', 'Cancelled');

-- CreateTable
CREATE TABLE "pur_request" (
    "id" SERIAL NOT NULL,
    "request_no" TEXT NOT NULL,
    "request_date" DATE NOT NULL,
    "item_type" "ItemType" NOT NULL,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'Draft',
    "requester" TEXT,
    "warehouse_id" INTEGER,
    "needed_date" DATE NOT NULL,
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pur_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pur_request_line" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "needed_date" DATE NOT NULL,
    "ordered_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "pur_request_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pur_request_request_no_key" ON "pur_request"("request_no");

-- CreateIndex
CREATE INDEX "pur_request_item_type_status_idx" ON "pur_request"("item_type", "status");

-- CreateIndex
CREATE INDEX "pur_request_line_item_id_idx" ON "pur_request_line"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "pur_request_line_request_id_line_no_key" ON "pur_request_line"("request_id", "line_no");

-- AddForeignKey
ALTER TABLE "pur_request" ADD CONSTRAINT "pur_request_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_request_line" ADD CONSTRAINT "pur_request_line_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "pur_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_request_line" ADD CONSTRAINT "pur_request_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pur_request_line" ADD CONSTRAINT "pur_request_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

