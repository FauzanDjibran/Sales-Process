-- P300: stock transfer between warehouses through a Gudang Transit
-- (Stock-Transfer-Plan.md): the user <-> warehouse assignment (OD-9), Transfer
-- Kirim and Transfer Terima. The pick keys are unique NULLS NOT DISTINCT, so a
-- warehouse without locations still has one row per lot and status.

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('Draft', 'InTransit', 'Received', 'Cancelled');

-- CreateEnum
CREATE TYPE "StockTransferReceiptStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "log_user_warehouse" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_user_warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_transfer" (
    "id" SERIAL NOT NULL,
    "transfer_no" TEXT NOT NULL,
    "transfer_date" DATE NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'Draft',
    "from_warehouse_id" INTEGER NOT NULL,
    "to_warehouse_id" INTEGER NOT NULL,
    "transit_warehouse_id" INTEGER,
    "vehicle_no" TEXT,
    "driver_name" TEXT,
    "note" TEXT,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_transfer_line" (
    "id" SERIAL NOT NULL,
    "stock_transfer_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "log_stock_transfer_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_transfer_tracking" (
    "id" SERIAL NOT NULL,
    "stock_transfer_line_id" INTEGER NOT NULL,
    "pick_no" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "location_id" INTEGER,
    "stock_status_id" INTEGER NOT NULL,
    "tracking_no" TEXT NOT NULL,
    "expiry_date" DATE,
    "base_qty" DECIMAL(18,4) NOT NULL,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "log_stock_transfer_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_transfer_receipt" (
    "id" SERIAL NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "receipt_date" DATE NOT NULL,
    "status" "StockTransferReceiptStatus" NOT NULL DEFAULT 'Draft',
    "stock_transfer_id" INTEGER NOT NULL,
    "to_warehouse_id" INTEGER NOT NULL,
    "note" TEXT,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_transfer_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_transfer_receipt_line" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "stock_transfer_line_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL,
    "note" TEXT,

    CONSTRAINT "log_stock_transfer_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_transfer_receipt_tracking" (
    "id" SERIAL NOT NULL,
    "receipt_line_id" INTEGER NOT NULL,
    "pick_no" INTEGER NOT NULL,
    "stock_transfer_tracking_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "stock_status_id" INTEGER NOT NULL,
    "location_id" INTEGER,
    "tracking_no" TEXT NOT NULL,
    "expiry_date" DATE,
    "base_qty" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "log_stock_transfer_receipt_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "log_user_warehouse_warehouse_id_idx" ON "log_user_warehouse"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_user_warehouse_user_id_warehouse_id_key" ON "log_user_warehouse"("user_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_transfer_no_key" ON "log_stock_transfer"("transfer_no");

-- CreateIndex
CREATE INDEX "log_stock_transfer_status_transfer_date_idx" ON "log_stock_transfer"("status", "transfer_date");

-- CreateIndex
CREATE INDEX "log_stock_transfer_from_warehouse_id_idx" ON "log_stock_transfer"("from_warehouse_id");

-- CreateIndex
CREATE INDEX "log_stock_transfer_to_warehouse_id_idx" ON "log_stock_transfer"("to_warehouse_id");

-- CreateIndex
CREATE INDEX "log_stock_transfer_line_item_id_idx" ON "log_stock_transfer_line"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_line_stock_transfer_id_line_no_key" ON "log_stock_transfer_line"("stock_transfer_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_line_stock_transfer_id_item_id_key" ON "log_stock_transfer_line"("stock_transfer_id", "item_id");

-- CreateIndex
CREATE INDEX "log_stock_transfer_tracking_tracking_id_idx" ON "log_stock_transfer_tracking"("tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_tracking_stock_transfer_line_id_pick_no_key" ON "log_stock_transfer_tracking"("stock_transfer_line_id", "pick_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_tracking_pick_key" ON "log_stock_transfer_tracking"("stock_transfer_line_id", "tracking_id", "location_id", "stock_status_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_receipt_receipt_no_key" ON "log_stock_transfer_receipt"("receipt_no");

-- CreateIndex
CREATE INDEX "log_stock_transfer_receipt_stock_transfer_id_idx" ON "log_stock_transfer_receipt"("stock_transfer_id");

-- CreateIndex
CREATE INDEX "log_stock_transfer_receipt_status_receipt_date_idx" ON "log_stock_transfer_receipt"("status", "receipt_date");

-- CreateIndex
CREATE INDEX "log_stock_transfer_receipt_line_stock_transfer_line_id_idx" ON "log_stock_transfer_receipt_line"("stock_transfer_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_receipt_line_receipt_id_line_no_key" ON "log_stock_transfer_receipt_line"("receipt_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_receipt_line_receipt_id_stock_transfer_l_key" ON "log_stock_transfer_receipt_line"("receipt_id", "stock_transfer_line_id");

-- CreateIndex
CREATE INDEX "log_stock_transfer_receipt_tracking_stock_transfer_tracking_idx" ON "log_stock_transfer_receipt_tracking"("stock_transfer_tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_receipt_tracking_receipt_line_id_pick_no_key" ON "log_stock_transfer_receipt_tracking"("receipt_line_id", "pick_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_transfer_receipt_tracking_pick_key" ON "log_stock_transfer_receipt_tracking"("receipt_line_id", "stock_transfer_tracking_id", "location_id") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "log_user_warehouse" ADD CONSTRAINT "log_user_warehouse_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer" ADD CONSTRAINT "log_stock_transfer_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer" ADD CONSTRAINT "log_stock_transfer_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_line" ADD CONSTRAINT "log_stock_transfer_line_stock_transfer_id_fkey" FOREIGN KEY ("stock_transfer_id") REFERENCES "log_stock_transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_line" ADD CONSTRAINT "log_stock_transfer_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_line" ADD CONSTRAINT "log_stock_transfer_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_tracking" ADD CONSTRAINT "log_stock_transfer_tracking_stock_transfer_line_id_fkey" FOREIGN KEY ("stock_transfer_line_id") REFERENCES "log_stock_transfer_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_receipt" ADD CONSTRAINT "log_stock_transfer_receipt_stock_transfer_id_fkey" FOREIGN KEY ("stock_transfer_id") REFERENCES "log_stock_transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_receipt" ADD CONSTRAINT "log_stock_transfer_receipt_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_receipt_line" ADD CONSTRAINT "log_stock_transfer_receipt_line_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "log_stock_transfer_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_receipt_line" ADD CONSTRAINT "log_stock_transfer_receipt_line_stock_transfer_line_id_fkey" FOREIGN KEY ("stock_transfer_line_id") REFERENCES "log_stock_transfer_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_receipt_line" ADD CONSTRAINT "log_stock_transfer_receipt_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_receipt_line" ADD CONSTRAINT "log_stock_transfer_receipt_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_receipt_tracking" ADD CONSTRAINT "log_stock_transfer_receipt_tracking_receipt_line_id_fkey" FOREIGN KEY ("receipt_line_id") REFERENCES "log_stock_transfer_receipt_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_transfer_receipt_tracking" ADD CONSTRAINT "log_stock_transfer_receipt_tracking_stock_transfer_trackin_fkey" FOREIGN KEY ("stock_transfer_tracking_id") REFERENCES "log_stock_transfer_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A transfer goes somewhere else; quantities are positive and never received beyond what left.
ALTER TABLE "log_stock_transfer" ADD CONSTRAINT "log_stock_transfer_two_warehouses" CHECK ("from_warehouse_id" <> "to_warehouse_id");
ALTER TABLE "log_stock_transfer_line" ADD CONSTRAINT "log_stock_transfer_line_qty" CHECK ("base_qty" > 0 AND "received_qty" >= 0 AND "received_qty" <= "base_qty");
ALTER TABLE "log_stock_transfer_tracking" ADD CONSTRAINT "log_stock_transfer_tracking_qty" CHECK ("base_qty" > 0 AND "received_qty" >= 0 AND "received_qty" <= "base_qty");
ALTER TABLE "log_stock_transfer_receipt_line" ADD CONSTRAINT "log_stock_transfer_receipt_line_qty" CHECK ("base_qty" > 0);
ALTER TABLE "log_stock_transfer_receipt_tracking" ADD CONSTRAINT "log_stock_transfer_receipt_tracking_qty" CHECK ("base_qty" > 0);

-- Permissions, so the role grants below can name them; the seed keeps their
-- names and descriptions in step with the catalogue.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('INVENTORY_WAREHOUSE_ALL', 'Buka semua Gudang', 'inventory', 'Tanpa ini, user hanya bekerja di Gudang yang ditugaskan kepadanya di form User.', now()),
  ('STOCK_TRANSFER_VIEW', 'Lihat Transfer Kirim', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_CREATE', 'Buat Transfer Kirim', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_EDIT', 'Ubah Transfer Kirim', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_SEND', 'Kirim Transfer Stok', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_CANCEL', 'Batalkan Transfer Kirim', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_RECEIPT_VIEW', 'Lihat Transfer Terima', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_RECEIPT_CREATE', 'Buat Transfer Terima', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_RECEIPT_EDIT', 'Ubah Transfer Terima', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_RECEIPT_POST', 'Posting Transfer Terima', 'inventory', NULL, now()),
  ('STOCK_TRANSFER_RECEIPT_CANCEL', 'Batalkan Transfer Terima', 'inventory', NULL, now())
ON CONFLICT ("permission_code") DO NOTHING;

-- Nobody loses a warehouse until an administrator starts assigning them: every
-- role holding a warehouse document permission today opens every warehouse.
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
  AND p."permission_code" IN ('RECEIPT_NOTE_VIEW', 'DELIVERY_NOTE_VIEW', 'STOCK_ISSUE_VIEW')
CROSS JOIN "sys_permission" m
WHERE m."permission_code" = 'INVENTORY_WAREHOUSE_ALL'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Whoever may do the matching step of a BSTB Issue may do it on a transfer.
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN (VALUES
  ('STOCK_ISSUE_VIEW', 'STOCK_TRANSFER_VIEW'),
  ('STOCK_ISSUE_CREATE', 'STOCK_TRANSFER_CREATE'),
  ('STOCK_ISSUE_EDIT', 'STOCK_TRANSFER_EDIT'),
  ('STOCK_ISSUE_SUBMIT', 'STOCK_TRANSFER_SEND'),
  ('STOCK_ISSUE_CANCEL', 'STOCK_TRANSFER_CANCEL'),
  ('STOCK_ISSUE_VIEW', 'STOCK_TRANSFER_RECEIPT_VIEW'),
  ('STOCK_ISSUE_CREATE', 'STOCK_TRANSFER_RECEIPT_CREATE'),
  ('STOCK_ISSUE_EDIT', 'STOCK_TRANSFER_RECEIPT_EDIT'),
  ('STOCK_ISSUE_POST', 'STOCK_TRANSFER_RECEIPT_POST'),
  ('STOCK_ISSUE_CANCEL', 'STOCK_TRANSFER_RECEIPT_CANCEL')
) AS g("source", "target") ON g."source" = p."permission_code"
JOIN "sys_permission" m ON m."permission_code" = g."target"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
