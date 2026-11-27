-- P339: the warehouse makes every Stock Receipt. What production sends waits as a
-- copy (`log_stock_receipt_inbox`) until a Stock Receipt naming it is received;
-- the receipt has a Draft, its own number, and the value a BSTB Pengeluaran
-- carries is chosen by the Unit at Kirim (`prd_issue.value_mode`).

CREATE TYPE "StockReceiptStatus" AS ENUM ('Draft', 'Received', 'Posted', 'Cancelled');

CREATE TABLE "log_stock_receipt_inbox" (
    "id" SERIAL NOT NULL,
    "sent_no" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "sent_date" DATE NOT NULL,
    "from_unit_id" INTEGER,
    "unit_label" TEXT NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "value_mode" TEXT NOT NULL DEFAULT 'carried',
    "note" TEXT,
    "base_cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "log_stock_receipt_inbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "log_stock_receipt_inbox_value_mode_check" CHECK ("value_mode" IN ('carried', 'none'))
);

CREATE TABLE "log_stock_receipt_inbox_line" (
    "id" SERIAL NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "tracking_no" TEXT NOT NULL,
    "expiry_date" DATE,
    "job_no" TEXT,
    "base_qty" DECIMAL(18,6) NOT NULL,
    "grams" DECIMAL(18,6),
    "base_cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    CONSTRAINT "log_stock_receipt_inbox_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "log_stock_receipt_inbox_line_qty_check" CHECK ("base_qty" > 0)
);

CREATE UNIQUE INDEX "log_stock_receipt_inbox_sent_no_key" ON "log_stock_receipt_inbox"("sent_no");
CREATE INDEX "log_stock_receipt_inbox_warehouse_id_idx" ON "log_stock_receipt_inbox"("warehouse_id");
CREATE UNIQUE INDEX "log_stock_receipt_inbox_line_inbox_id_seq_key" ON "log_stock_receipt_inbox_line"("inbox_id", "seq");
ALTER TABLE "log_stock_receipt_inbox" ADD CONSTRAINT "log_stock_receipt_inbox_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "ref_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "log_stock_receipt_inbox" ADD CONSTRAINT "log_stock_receipt_inbox_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "log_stock_receipt_inbox_line" ADD CONSTRAINT "log_stock_receipt_inbox_line_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "log_stock_receipt_inbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "log_stock_receipt_inbox_line" ADD CONSTRAINT "log_stock_receipt_inbox_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The Unit chooses a BSTB Pengeluaran's value. One already received keeps what the warehouse chose.
ALTER TABLE "prd_issue" ADD COLUMN "value_mode" TEXT NOT NULL DEFAULT 'carried';
ALTER TABLE "prd_issue" ADD CONSTRAINT "prd_issue_value_mode_check" CHECK ("value_mode" IN ('carried', 'none'));
UPDATE "prd_issue" i SET "value_mode" = r."value_mode"
  FROM "log_stock_receipt" r
 WHERE r."receipt_no" = i."issue_no" AND r."status" = 'Received' AND r."value_mode" = 'none';

-- Every production shipment, waiting or taken in, gets its copy.
INSERT INTO "log_stock_receipt_inbox" ("sent_no", "purpose", "sent_date", "from_unit_id", "unit_label", "warehouse_id", "value_mode", "note", "base_cost_amount", "created_by", "created_at")
SELECT r."receipt_no", r."purpose", r."receipt_date", r."from_unit_id", COALESCE(u."unit_label", ''), r."warehouse_id",
       COALESCE(i."value_mode", 'carried'), r."note", r."base_cost_amount", r."created_by", r."created_at"
  FROM "log_stock_receipt" r
  LEFT JOIN "ref_unit" u ON u."id" = r."from_unit_id"
  LEFT JOIN "prd_issue" i ON i."issue_no" = r."receipt_no"
 WHERE r."purpose" IN ('finish_goods', 'return');

INSERT INTO "log_stock_receipt_inbox_line" ("inbox_id", "seq", "item_id", "tracking_no", "expiry_date", "job_no", "base_qty", "grams", "base_cost_amount")
SELECT x."id", ROW_NUMBER() OVER (PARTITION BY x."id" ORDER BY l."line_no", t."seq"), l."item_id", t."tracking_no", t."expiry_date", t."job_no", t."base_qty", t."grams", t."base_cost_amount"
  FROM "log_stock_receipt_inbox" x
  JOIN "log_stock_receipt" r ON r."receipt_no" = x."sent_no"
  JOIN "log_stock_receipt_line" l ON l."stock_receipt_id" = r."id"
  JOIN "log_stock_receipt_tracking" t ON t."stock_receipt_line_id" = l."id";

ALTER TABLE "log_stock_receipt" ADD COLUMN "inbox_id" INTEGER, ADD COLUMN "status_reason" TEXT;
ALTER TABLE "log_stock_receipt" ADD CONSTRAINT "log_stock_receipt_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "log_stock_receipt_inbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "log_stock_receipt_inbox_id_idx" ON "log_stock_receipt"("inbox_id");

-- A received one names its copy and the sender's number.
UPDATE "log_stock_receipt" r SET "inbox_id" = x."id", "source_no" = x."sent_no"
  FROM "log_stock_receipt_inbox" x
 WHERE x."sent_no" = r."receipt_no" AND r."status" = 'Received';

-- A waiting one was never the warehouse's: it is only its copy now.
DELETE FROM "audit_log" WHERE "entity_key" = 'log_stock_receipt' AND "row_id" IN (SELECT "id" FROM "log_stock_receipt" WHERE "status" = 'InTransit');
DELETE FROM "log_stock_receipt_tracking" WHERE "stock_receipt_line_id" IN (SELECT l."id" FROM "log_stock_receipt_line" l JOIN "log_stock_receipt" r ON r."id" = l."stock_receipt_id" WHERE r."status" = 'InTransit');
DELETE FROM "log_stock_receipt_line" WHERE "stock_receipt_id" IN (SELECT "id" FROM "log_stock_receipt" WHERE "status" = 'InTransit');
DELETE FROM "log_stock_receipt" WHERE "status" = 'InTransit';

ALTER TABLE "log_stock_receipt" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "log_stock_receipt" ALTER COLUMN "status" TYPE "StockReceiptStatus" USING "status"::text::"StockReceiptStatus";
ALTER TABLE "log_stock_receipt" ALTER COLUMN "status" SET DEFAULT 'Draft';

-- One live Stock Receipt per shipment and per Receipt Note's bonus: a Draft holds its source.
CREATE UNIQUE INDEX "log_stock_receipt_one_per_inbox" ON "log_stock_receipt"("inbox_id") WHERE "status" <> 'Cancelled' AND "inbox_id" IS NOT NULL;
CREATE UNIQUE INDEX "log_stock_receipt_one_per_bonus" ON "log_stock_receipt"("source_doc_id") WHERE "status" <> 'Cancelled' AND "purpose" = 'purchase_bonus';

INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('STOCK_RECEIPT_CREATE', 'Buat Stock Receipt', 'inventory', now()),
  ('STOCK_RECEIPT_EDIT', 'Ubah Stock Receipt', 'inventory', now()),
  ('STOCK_RECEIPT_CANCEL', 'Batalkan Stock Receipt', 'inventory', now())
ON CONFLICT ("permission_code") DO NOTHING;
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id" FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'STOCK_RECEIPT_RECEIVE'
JOIN "sys_permission" m ON m."permission_code" IN ('STOCK_RECEIPT_CREATE', 'STOCK_RECEIPT_EDIT', 'STOCK_RECEIPT_CANCEL')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
