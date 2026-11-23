-- Stock Adjustment, and the Unit cost naming production's partai by number (P318).
-- CreateEnum
CREATE TYPE "StockAdjustmentStatus" AS ENUM ('Draft', 'Submitted', 'Posted', 'Rejected', 'Cancelled');

-- DropForeignKey
ALTER TABLE "prd_cost_entry" DROP CONSTRAINT "prd_cost_entry_partai_id_fkey";

-- AlterTable
ALTER TABLE "prd_cost_entry" ADD COLUMN "partai_no" TEXT;
UPDATE "prd_cost_entry" e SET "partai_no" = p."partai_no" FROM "prd_partai" p WHERE p."id" = e."partai_id";
ALTER TABLE "prd_cost_entry" DROP COLUMN "partai_id";

-- CreateTable
CREATE TABLE "log_stock_adjustment" (
    "id" SERIAL NOT NULL,
    "adjustment_no" TEXT NOT NULL,
    "adjustment_date" DATE NOT NULL,
    "status" "StockAdjustmentStatus" NOT NULL DEFAULT 'Draft',
    "warehouse_id" INTEGER NOT NULL,
    "note" TEXT,
    "short_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "over_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_stock_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_stock_adjustment_line" (
    "id" SERIAL NOT NULL,
    "stock_adjustment_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "tracking_no" TEXT NOT NULL,
    "location_id" INTEGER,
    "stock_status_id" INTEGER NOT NULL,
    "book_qty" DECIMAL(18,6) NOT NULL,
    "counted_qty" DECIMAL(18,6),
    "typed_value" DECIMAL(18,2),
    "value_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "log_stock_adjustment_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_adjustment_adjustment_no_key" ON "log_stock_adjustment"("adjustment_no");

-- CreateIndex
CREATE INDEX "log_stock_adjustment_status_adjustment_date_idx" ON "log_stock_adjustment"("status", "adjustment_date");

-- CreateIndex
CREATE INDEX "log_stock_adjustment_warehouse_id_idx" ON "log_stock_adjustment"("warehouse_id");

-- CreateIndex
CREATE INDEX "log_stock_adjustment_line_tracking_id_idx" ON "log_stock_adjustment_line"("tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "log_stock_adjustment_line_stock_adjustment_id_line_no_key" ON "log_stock_adjustment_line"("stock_adjustment_id", "line_no");

-- AddForeignKey
ALTER TABLE "log_stock_adjustment" ADD CONSTRAINT "log_stock_adjustment_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_adjustment_line" ADD CONSTRAINT "log_stock_adjustment_line_stock_adjustment_id_fkey" FOREIGN KEY ("stock_adjustment_id") REFERENCES "log_stock_adjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_stock_adjustment_line" ADD CONSTRAINT "log_stock_adjustment_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "log_stock_adjustment_line" ADD CONSTRAINT "log_stock_adjustment_line_qty" CHECK ("book_qty" >= 0 AND ("counted_qty" IS NULL OR "counted_qty" >= 0));

-- Whoever transfers stock may count it; approving is the administrator's until a role is given it.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('STOCK_ADJUSTMENT_VIEW', 'Lihat Stock Adjustment', 'inventory', now()),
  ('STOCK_ADJUSTMENT_CREATE', 'Buat Stock Adjustment', 'inventory', now()),
  ('STOCK_ADJUSTMENT_EDIT', 'Ubah Stock Adjustment', 'inventory', now()),
  ('STOCK_ADJUSTMENT_SUBMIT', 'Ajukan Stock Adjustment', 'inventory', now()),
  ('STOCK_ADJUSTMENT_CANCEL', 'Batalkan Stock Adjustment', 'inventory', now())
ON CONFLICT ("permission_code") DO NOTHING;
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id" FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN (VALUES
  ('STOCK_TRANSFER_VIEW', 'STOCK_ADJUSTMENT_VIEW'),
  ('STOCK_TRANSFER_CREATE', 'STOCK_ADJUSTMENT_CREATE'),
  ('STOCK_TRANSFER_EDIT', 'STOCK_ADJUSTMENT_EDIT'),
  ('STOCK_TRANSFER_SEND', 'STOCK_ADJUSTMENT_SUBMIT'),
  ('STOCK_TRANSFER_CANCEL', 'STOCK_ADJUSTMENT_CANCEL')
) AS g("source", "target") ON g."source" = p."permission_code"
JOIN "sys_permission" m ON m."permission_code" = g."target"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
