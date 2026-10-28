-- AlterTable
ALTER TABLE "acc_fiscal_period" ADD COLUMN     "production_costed_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "prd_cost_close" (
    "id" SERIAL NOT NULL,
    "period_id" INTEGER NOT NULL,
    "close_date" DATE NOT NULL,
    "journal_id" INTEGER,
    "leftover_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_cost_close_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_close_pool" (
    "id" SERIAL NOT NULL,
    "close_id" INTEGER NOT NULL,
    "cost_center_id" INTEGER NOT NULL,
    "standard_cost_item_id" INTEGER NOT NULL,
    "actual" DECIMAL(18,2) NOT NULL,
    "standard" DECIMAL(18,2) NOT NULL,
    "overhead" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "leftover" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "prd_cost_close_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_close_share" (
    "id" SERIAL NOT NULL,
    "close_id" INTEGER NOT NULL,
    "execution_id" INTEGER NOT NULL,
    "driver" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "prd_cost_close_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_cost_close_dest" (
    "id" SERIAL NOT NULL,
    "close_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "item_id" INTEGER,
    "bucket_id" INTEGER,
    "account_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "prd_cost_close_dest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_close_period_id_key" ON "prd_cost_close"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_close_pool_close_id_cost_center_id_standard_cost_i_key" ON "prd_cost_close_pool"("close_id", "cost_center_id", "standard_cost_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_cost_close_share_close_id_execution_id_key" ON "prd_cost_close_share"("close_id", "execution_id");

-- CreateIndex
CREATE INDEX "prd_cost_close_dest_close_id_kind_idx" ON "prd_cost_close_dest"("close_id", "kind");

-- AddForeignKey
ALTER TABLE "prd_cost_close" ADD CONSTRAINT "prd_cost_close_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "acc_fiscal_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_close_pool" ADD CONSTRAINT "prd_cost_close_pool_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "prd_cost_close"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_close_share" ADD CONSTRAINT "prd_cost_close_share_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "prd_cost_close"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_cost_close_dest" ADD CONSTRAINT "prd_cost_close_dest_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "prd_cost_close"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permissions of the month-end close (P172): whoever opens the production menu may read it; the act itself is its own.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('PRODUCTION_COST_CLOSE_VIEW', 'Lihat Penutupan Biaya Produksi', 'production', now()),
  ('PRODUCTION_COST_CLOSE_RUN', 'Menjalankan Penutupan Biaya Produksi', 'production', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", n."id"
  FROM "sys_role_permission" rp
  JOIN "sys_permission" h ON h."id" = rp."permission_id" AND h."permission_code" = 'REPORT_COST_CENTER_VIEW'
  CROSS JOIN "sys_permission" n
 WHERE n."permission_code" = 'PRODUCTION_COST_CLOSE_VIEW'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
