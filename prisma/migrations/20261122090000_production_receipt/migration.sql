-- P303: BSTB ke Finish Goods (Simulasi-Gudang-Produksi-Plan.md 7.5). Finished goods
-- sent from the last Unit of a line's routing wait as Dalam Perjalanan until the
-- warehouse presses Terima, which takes them into stock under the same No. Stok.

-- CreateEnum
CREATE TYPE "ProductionReceiptStatus" AS ENUM ('Submitted', 'Posted');

-- CreateTable
CREATE TABLE "log_production_receipt" (
    "id" SERIAL NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'finish_goods',
    "receipt_date" DATE NOT NULL,
    "status" "ProductionReceiptStatus" NOT NULL DEFAULT 'Submitted',
    "from_unit_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "note" TEXT,
    "received_at" DATE,
    "received_by" INTEGER,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_production_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_production_receipt_line" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "job_id" INTEGER,
    "qty" DECIMAL(18,4) NOT NULL,
    "grams" DECIMAL(18,4),
    "from_bucket_id" INTEGER NOT NULL,
    "transit_bucket_id" INTEGER NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "log_production_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "log_production_receipt_receipt_no_key" ON "log_production_receipt"("receipt_no");

-- CreateIndex
CREATE INDEX "log_production_receipt_status_receipt_date_idx" ON "log_production_receipt"("status", "receipt_date");

-- CreateIndex
CREATE INDEX "log_production_receipt_from_unit_id_idx" ON "log_production_receipt"("from_unit_id");

-- CreateIndex
CREATE INDEX "log_production_receipt_line_tracking_id_idx" ON "log_production_receipt_line"("tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_production_receipt_line_receipt_id_line_no_key" ON "log_production_receipt_line"("receipt_id", "line_no");

-- AddForeignKey
ALTER TABLE "log_production_receipt" ADD CONSTRAINT "log_production_receipt_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_production_receipt" ADD CONSTRAINT "log_production_receipt_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_production_receipt_line" ADD CONSTRAINT "log_production_receipt_line_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "log_production_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_production_receipt_line" ADD CONSTRAINT "log_production_receipt_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A line is sent and released at a positive quantity, never a negative value.
ALTER TABLE "log_production_receipt_line" ADD CONSTRAINT "log_production_receipt_line_qty" CHECK ("qty" > 0 AND "value" >= 0);

-- Permissions, so the role grants below can name them; the seed keeps their
-- names and descriptions in step with the catalogue.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('PRODUCTION_RECEIPT_VIEW', 'Lihat BSTB ke Finish Goods', 'inventory', NULL, now()),
  ('PRODUCTION_RECEIPT_RECEIVE', 'Terima BSTB ke Finish Goods', 'inventory', NULL, now()),
  ('PRODUCTION_RECEIPT_SEND', 'Kirim ke Finish Goods', 'production', NULL, now())
ON CONFLICT ("permission_code") DO NOTHING;

-- Whoever sees and hands goods over on a BSTB Issue sees and takes them back in;
-- whoever sends a BSTB between Units sends one to Finish Goods.
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN (VALUES
  ('STOCK_ISSUE_VIEW', 'PRODUCTION_RECEIPT_VIEW'),
  ('STOCK_ISSUE_SUBMIT', 'PRODUCTION_RECEIPT_RECEIVE'),
  ('PRODUCTION_TRANSFER_CREATE', 'PRODUCTION_RECEIPT_SEND')
) AS g("source", "target") ON g."source" = p."permission_code"
JOIN "sys_permission" m ON m."permission_code" = g."target"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
