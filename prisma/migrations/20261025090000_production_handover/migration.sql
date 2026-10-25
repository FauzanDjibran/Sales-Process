-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('Draft', 'Posted', 'Received', 'Rejected', 'Cancelled');

-- AlterEnum
ALTER TYPE "PrdMovement" ADD VALUE 'Sent';

-- AlterTable
ALTER TABLE "prd_partai" ADD COLUMN     "order_id" INTEGER;

-- CreateTable
CREATE TABLE "prd_handover" (
    "id" SERIAL NOT NULL,
    "handover_no" TEXT NOT NULL,
    "handover_date" DATE NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'Draft',
    "from_workstation_id" INTEGER NOT NULL,
    "to_workstation_id" INTEGER NOT NULL,
    "order_id" INTEGER,
    "partai_id" INTEGER,
    "note" TEXT,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "received_date" DATE,
    "received_by" INTEGER,
    "reject_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_handover_line" (
    "id" SERIAL NOT NULL,
    "handover_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "source_bucket_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "lot_no" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "box_no" INTEGER,
    "job_id" INTEGER,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transit_bucket_id" INTEGER,
    "received_bucket_id" INTEGER,

    CONSTRAINT "prd_handover_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_handover_handover_no_key" ON "prd_handover"("handover_no");

-- CreateIndex
CREATE INDEX "prd_handover_status_handover_date_idx" ON "prd_handover"("status", "handover_date");

-- CreateIndex
CREATE INDEX "prd_handover_order_id_idx" ON "prd_handover"("order_id");

-- CreateIndex
CREATE INDEX "prd_handover_partai_id_idx" ON "prd_handover"("partai_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_handover_line_handover_id_line_no_key" ON "prd_handover_line"("handover_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "prd_handover_line_handover_id_source_bucket_id_key" ON "prd_handover_line"("handover_id", "source_bucket_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_partai_order_id_key" ON "prd_partai"("order_id");

-- AddForeignKey
ALTER TABLE "prd_partai" ADD CONSTRAINT "prd_partai_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "prd_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_handover" ADD CONSTRAINT "prd_handover_from_workstation_id_fkey" FOREIGN KEY ("from_workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_handover" ADD CONSTRAINT "prd_handover_to_workstation_id_fkey" FOREIGN KEY ("to_workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_handover" ADD CONSTRAINT "prd_handover_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "prd_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_handover_line" ADD CONSTRAINT "prd_handover_line_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "prd_handover"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "prd_handover_line" ADD CONSTRAINT "prd_handover_line_qty_positive" CHECK ("qty" > 0);

-- Permissions of the hand-over (P167). Whoever held the nearest Perintah or
-- BSTB permission keeps the matching one: the Perintah's for seeing, making,
-- changing and cancelling; opening a Perintah for posting; receiving a BSTB
-- for Terima / Tolak.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('PRODUCTION_HANDOVER_VIEW', 'Lihat Hand-over Produksi', 'production', now()),
  ('PRODUCTION_HANDOVER_CREATE', 'Buat Hand-over Produksi', 'production', now()),
  ('PRODUCTION_HANDOVER_EDIT', 'Ubah Hand-over Produksi', 'production', now()),
  ('PRODUCTION_HANDOVER_POST', 'Posting Hand-over Produksi', 'production', now()),
  ('PRODUCTION_HANDOVER_CANCEL', 'Batalkan Hand-over Produksi', 'production', now()),
  ('PRODUCTION_HANDOVER_RECEIVE', 'Terima / Tolak Hand-over Produksi', 'production', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", n."id"
  FROM (VALUES
    ('PRODUCTION_ORDER_VIEW', 'PRODUCTION_HANDOVER_VIEW'),
    ('PRODUCTION_ORDER_CREATE', 'PRODUCTION_HANDOVER_CREATE'),
    ('PRODUCTION_ORDER_EDIT', 'PRODUCTION_HANDOVER_EDIT'),
    ('PRODUCTION_ORDER_OPEN', 'PRODUCTION_HANDOVER_POST'),
    ('PRODUCTION_ORDER_CANCEL', 'PRODUCTION_HANDOVER_CANCEL'),
    ('STOCK_ISSUE_RECEIVE', 'PRODUCTION_HANDOVER_RECEIVE')
  ) AS m(held, given)
  JOIN "sys_permission" h ON h."permission_code" = m.held
  JOIN "sys_role_permission" rp ON rp."permission_id" = h."id"
  JOIN "sys_permission" n ON n."permission_code" = m.given
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
