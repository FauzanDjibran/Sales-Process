/*
  Warnings:

  - You are about to drop the `tmp_item_cost` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tmp_stock_lot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tmp_stock_movement` table. If the table is not empty, all the data it contains will be lost.

*/
-- P120: the stock ledger replaces the stand-in inventory (U11, P94, P95).
-- Quantity per warehouse / lot / status and value per item's moving-average
-- pool (P114), each a ledger with its balance. The stand-in's Harga Pokok, lot
-- list and issue log are dropped: posted Delivery Notes keep the cost, lot
-- number and expiry they copied, and their journals. The ledger starts empty;
-- stock comes in through `db:stock-inject`.

-- Lot ids continue after the stand-in's, so a Draft Delivery Note still naming
-- an old lot finds nothing rather than a different lot, and is re-picked.
CREATE TABLE "_lot_floor" AS SELECT COALESCE(MAX("id"), 0) AS "m" FROM "tmp_stock_lot";

-- DropForeignKey
ALTER TABLE "tmp_item_cost" DROP CONSTRAINT "tmp_item_cost_item_id_fkey";

-- DropForeignKey
ALTER TABLE "tmp_stock_lot" DROP CONSTRAINT "tmp_stock_lot_item_id_fkey";

-- DropForeignKey
ALTER TABLE "tmp_stock_lot" DROP CONSTRAINT "tmp_stock_lot_warehouse_id_fkey";

-- DropForeignKey
ALTER TABLE "tmp_stock_movement" DROP CONSTRAINT "tmp_stock_movement_item_id_fkey";

-- DropForeignKey
ALTER TABLE "tmp_stock_movement" DROP CONSTRAINT "tmp_stock_movement_warehouse_id_fkey";

-- DropTable
DROP TABLE "tmp_item_cost";

-- DropTable
DROP TABLE "tmp_stock_lot";

-- DropTable
DROP TABLE "tmp_stock_movement";

-- CreateTable
CREATE TABLE "sys_stock_status" (
    "id" SERIAL NOT NULL,
    "status_code" TEXT NOT NULL,
    "status_label" TEXT NOT NULL,
    "status_name" TEXT NOT NULL,
    "is_issuable" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_stock_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_tracking" (
    "id" SERIAL NOT NULL,
    "tracking_no" TEXT NOT NULL,
    "tracking_date" DATE NOT NULL,
    "item_id" INTEGER NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "source_partner_id" INTEGER,
    "expiry_date" DATE,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_ledger" (
    "id" SERIAL NOT NULL,
    "ledger_no" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "posting_date" DATE NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "stock_status_id" INTEGER NOT NULL,
    "qty_change" DECIMAL(18,6) NOT NULL,
    "qty_balance" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "value_change" DECIMAL(18,2) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_balance" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "stock_status_id" INTEGER NOT NULL,
    "qty_balance" DECIMAL(18,6) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_valuation_ledger" (
    "id" SERIAL NOT NULL,
    "ledger_no" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "posting_date" DATE NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "qty_change" DECIMAL(18,6) NOT NULL,
    "qty_balance" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6),
    "value_change" DECIMAL(18,2) NOT NULL,
    "value_balance" DECIMAL(18,2) NOT NULL,
    "avg_unit_cost" DECIMAL(18,6) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_valuation_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_valuation_balance" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "qty_balance" DECIMAL(18,6) NOT NULL,
    "value_balance" DECIMAL(18,2) NOT NULL,
    "avg_unit_cost" DECIMAL(18,6) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_valuation_balance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_stock_status_status_code_key" ON "sys_stock_status"("status_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_stock_status_status_label_key" ON "sys_stock_status"("status_label");

-- CreateIndex
CREATE INDEX "log_stock_tracking_source_doc_type_id_source_doc_id_idx" ON "log_stock_tracking"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_tracking_item_id_tracking_no_key" ON "log_stock_tracking"("item_id", "tracking_no");

-- CreateIndex
CREATE INDEX "log_stock_ledger_item_id_warehouse_id_posting_date_idx" ON "log_stock_ledger"("item_id", "warehouse_id", "posting_date");

-- CreateIndex
CREATE INDEX "log_stock_ledger_tracking_id_idx" ON "log_stock_ledger"("tracking_id");

-- CreateIndex
CREATE INDEX "log_stock_ledger_source_doc_type_id_source_doc_id_idx" ON "log_stock_ledger"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_ledger_ledger_no_line_no_key" ON "log_stock_ledger"("ledger_no", "line_no");

-- CreateIndex
CREATE INDEX "log_stock_balance_item_id_warehouse_id_idx" ON "log_stock_balance"("item_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_balance_warehouse_id_tracking_id_stock_status_id_key" ON "log_stock_balance"("warehouse_id", "tracking_id", "stock_status_id");

-- CreateIndex
CREATE INDEX "log_stock_valuation_ledger_item_id_posting_date_idx" ON "log_stock_valuation_ledger"("item_id", "posting_date");

-- CreateIndex
CREATE INDEX "log_stock_valuation_ledger_source_doc_type_id_source_doc_id_idx" ON "log_stock_valuation_ledger"("source_doc_type_id", "source_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_valuation_ledger_ledger_no_line_no_key" ON "log_stock_valuation_ledger"("ledger_no", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_valuation_balance_item_id_key" ON "log_stock_valuation_balance"("item_id");

-- AddForeignKey
ALTER TABLE "log_stock_tracking" ADD CONSTRAINT "log_stock_tracking_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_tracking" ADD CONSTRAINT "log_stock_tracking_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_tracking" ADD CONSTRAINT "log_stock_tracking_source_partner_id_fkey" FOREIGN KEY ("source_partner_id") REFERENCES "m_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_ledger" ADD CONSTRAINT "log_stock_ledger_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_ledger" ADD CONSTRAINT "log_stock_ledger_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_ledger" ADD CONSTRAINT "log_stock_ledger_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_ledger" ADD CONSTRAINT "log_stock_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_ledger" ADD CONSTRAINT "log_stock_ledger_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_ledger" ADD CONSTRAINT "log_stock_ledger_stock_status_id_fkey" FOREIGN KEY ("stock_status_id") REFERENCES "sys_stock_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_balance" ADD CONSTRAINT "log_stock_balance_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_balance" ADD CONSTRAINT "log_stock_balance_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_balance" ADD CONSTRAINT "log_stock_balance_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_balance" ADD CONSTRAINT "log_stock_balance_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_balance" ADD CONSTRAINT "log_stock_balance_stock_status_id_fkey" FOREIGN KEY ("stock_status_id") REFERENCES "sys_stock_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_valuation_ledger" ADD CONSTRAINT "log_stock_valuation_ledger_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_valuation_ledger" ADD CONSTRAINT "log_stock_valuation_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_valuation_ledger" ADD CONSTRAINT "log_stock_valuation_ledger_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_valuation_balance" ADD CONSTRAINT "log_stock_valuation_balance_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_valuation_balance" ADD CONSTRAINT "log_stock_valuation_balance_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

SELECT setval(pg_get_serial_sequence('log_stock_tracking', 'id'), (SELECT "m" FROM "_lot_floor") + 1, false);
DROP TABLE "_lot_floor";

-- Stock statuses (system data; the seed matches them on their code).
INSERT INTO "sys_stock_status" ("status_code", "status_label", "status_name", "is_issuable", "sort_order", "created_by", "updated_at") VALUES
  ('stst.0001', 'TERSEDIA', 'Tersedia', true, 1, 0, now()),
  ('stst.0002', 'KARANTINA', 'Karantina', false, 2, 0, now()),
  ('stst.0003', 'DIBLOKIR', 'Diblokir', false, 3, 0, now())
ON CONFLICT ("status_code") DO NOTHING;

-- The stand-in's permissions go with it.
DELETE FROM "sys_role_permission" WHERE "permission_id" IN (
  SELECT "id" FROM "sys_permission" WHERE "permission_code" IN ('ITEM_COST_VIEW', 'ITEM_COST_EDIT', 'STOCK_LOT_VIEW', 'STOCK_LOT_EDIT'));
DELETE FROM "sys_permission" WHERE "permission_code" IN ('ITEM_COST_VIEW', 'ITEM_COST_EDIT', 'STOCK_LOT_VIEW', 'STOCK_LOT_EDIT');

-- The Persediaan menu and its reports, granted to every role that could see
-- Delivery Notes (the documents that move stock today).
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('MENU_INVENTORY_ACCESS', 'Akses menu Persediaan', 'inventory', now()),
  ('REPORT_STOCK_LEDGER_VIEW', 'Lihat Kartu Stok', 'inventory', now()),
  ('REPORT_STOCK_BALANCE_VIEW', 'Lihat Saldo Stok', 'inventory', now()),
  ('REPORT_STOCK_VALUATION_LEDGER_VIEW', 'Lihat Kartu Nilai Persediaan', 'inventory', now()),
  ('REPORT_STOCK_VALUATION_VIEW', 'Lihat Nilai Persediaan', 'inventory', now())
ON CONFLICT ("permission_code") DO NOTHING;
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'DELIVERY_NOTE_VIEW'
CROSS JOIN "sys_permission" m
WHERE m."permission_code" IN ('MENU_INVENTORY_ACCESS', 'REPORT_STOCK_LEDGER_VIEW', 'REPORT_STOCK_BALANCE_VIEW',
                              'REPORT_STOCK_VALUATION_LEDGER_VIEW', 'REPORT_STOCK_VALUATION_VIEW')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- No negative stock (P114), held by the database too.
ALTER TABLE "log_stock_balance" ADD CONSTRAINT "log_stock_balance_qty_nonnegative" CHECK ("qty_balance" >= 0);
ALTER TABLE "log_stock_valuation_balance" ADD CONSTRAINT "log_stock_valuation_balance_nonnegative" CHECK ("qty_balance" >= 0 AND "value_balance" >= 0);
