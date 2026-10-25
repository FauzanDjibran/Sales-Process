-- CreateEnum
CREATE TYPE "ProductionPlanStatus" AS ENUM ('Draft', 'Submitted', 'Open', 'Closed', 'Cancelled', 'Rejected');

-- AlterTable
ALTER TABLE "prd_order" ADD COLUMN     "plan_line_id" INTEGER;

-- CreateTable
CREATE TABLE "prd_plan" (
    "id" SERIAL NOT NULL,
    "plan_no" TEXT NOT NULL,
    "plan_date" DATE NOT NULL,
    "period" DATE NOT NULL,
    "status" "ProductionPlanStatus" NOT NULL DEFAULT 'Draft',
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_plan_line" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "start_date" DATE NOT NULL,
    "note" TEXT,

    CONSTRAINT "prd_plan_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_plan_line_demand" (
    "id" SERIAL NOT NULL,
    "plan_line_id" INTEGER NOT NULL,
    "so_line_id" INTEGER NOT NULL,
    "so_id" INTEGER NOT NULL,
    "so_no" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "prd_plan_line_demand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_plan_plan_no_key" ON "prd_plan"("plan_no");

-- CreateIndex
CREATE INDEX "prd_plan_status_period_idx" ON "prd_plan"("status", "period");

-- CreateIndex
CREATE UNIQUE INDEX "prd_plan_line_plan_id_line_no_key" ON "prd_plan_line"("plan_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "prd_plan_line_plan_id_item_id_start_date_key" ON "prd_plan_line"("plan_id", "item_id", "start_date");

-- CreateIndex
CREATE INDEX "prd_plan_line_demand_so_line_id_idx" ON "prd_plan_line_demand"("so_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_plan_line_demand_plan_line_id_so_line_id_key" ON "prd_plan_line_demand"("plan_line_id", "so_line_id");

-- CreateIndex
CREATE INDEX "prd_order_plan_line_id_idx" ON "prd_order"("plan_line_id");

-- AddForeignKey
ALTER TABLE "prd_order" ADD CONSTRAINT "prd_order_plan_line_id_fkey" FOREIGN KEY ("plan_line_id") REFERENCES "prd_plan_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_plan_line" ADD CONSTRAINT "prd_plan_line_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "prd_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_plan_line" ADD CONSTRAINT "prd_plan_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_plan_line_demand" ADD CONSTRAINT "prd_plan_line_demand_plan_line_id_fkey" FOREIGN KEY ("plan_line_id") REFERENCES "prd_plan_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "prd_plan_line" ADD CONSTRAINT "prd_plan_line_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "prd_plan_line_demand" ADD CONSTRAINT "prd_plan_line_demand_qty_positive" CHECK ("qty" > 0);

-- Permissions of the Rencana Produksi (P168). Whoever held the nearest Perintah
-- permission keeps the matching one; approving is the Customer Order's approver's.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('PRODUCTION_PLAN_VIEW', 'Lihat Rencana Produksi', 'production', now()),
  ('PRODUCTION_PLAN_CREATE', 'Buat Rencana Produksi', 'production', now()),
  ('PRODUCTION_PLAN_EDIT', 'Ubah Rencana Produksi', 'production', now()),
  ('PRODUCTION_PLAN_SUBMIT', 'Ajukan Rencana Produksi', 'production', now()),
  ('PRODUCTION_PLAN_APPROVE', 'Setujui / Tolak Rencana Produksi', 'production', now()),
  ('PRODUCTION_PLAN_CANCEL', 'Batalkan Rencana Produksi', 'production', now()),
  ('PRODUCTION_PLAN_CLOSE', 'Tutup Rencana Produksi', 'production', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", n."id"
  FROM (VALUES
    ('PRODUCTION_ORDER_VIEW', 'PRODUCTION_PLAN_VIEW'),
    ('PRODUCTION_ORDER_CREATE', 'PRODUCTION_PLAN_CREATE'),
    ('PRODUCTION_ORDER_EDIT', 'PRODUCTION_PLAN_EDIT'),
    ('PRODUCTION_ORDER_CREATE', 'PRODUCTION_PLAN_SUBMIT'),
    ('SALES_ORDER_APPROVE', 'PRODUCTION_PLAN_APPROVE'),
    ('PRODUCTION_ORDER_CANCEL', 'PRODUCTION_PLAN_CANCEL'),
    ('PRODUCTION_ORDER_CLOSE', 'PRODUCTION_PLAN_CLOSE')
  ) AS m(held, given)
  JOIN "sys_permission" h ON h."permission_code" = m.held
  JOIN "sys_role_permission" rp ON rp."permission_id" = h."id"
  JOIN "sys_permission" n ON n."permission_code" = m.given
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
