-- Production Phase 5a — the costing masters (P159; production_project.md
-- M93–M95 as amended): the Cost Center types, an Overhead's spread, the
-- Workstation's own Cost Center and the Tarif Standar per workstation.
-- Nothing here posts; the Eksekusi Produksi (Phase 5) and the close (Phase 8)
-- read it.

-- ---------------------------------------------------------- Cost Center
-- The new values are not used in this migration: PostgreSQL refuses a value
-- added in the same transaction, so "spread only on an Overhead" is the
-- application's rule and a reconcile check, not a CHECK here.
ALTER TYPE "CostCenterType" ADD VALUE 'Overhead';
ALTER TYPE "CostCenterType" ADD VALUE 'Administrative';

CREATE TYPE "CostCenterSpreadMethod" AS ENUM ('Even', 'Percent');

ALTER TABLE "acc_cost_center" ADD COLUMN "spread_method" "CostCenterSpreadMethod";

CREATE TABLE "acc_cost_center_spread" (
    "id" SERIAL NOT NULL,
    "overhead_cost_center_id" INTEGER NOT NULL,
    "production_cost_center_id" INTEGER NOT NULL,
    "percent" DECIMAL(9,4) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_cost_center_spread_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "acc_cost_center_spread_percent_check" CHECK ("percent" > 0 AND "percent" <= 100),
    CONSTRAINT "acc_cost_center_spread_not_self_check" CHECK ("overhead_cost_center_id" <> "production_cost_center_id")
);

CREATE UNIQUE INDEX "acc_cost_center_spread_overhead_cost_center_id_production_c_key" ON "acc_cost_center_spread"("overhead_cost_center_id", "production_cost_center_id");
CREATE INDEX "acc_cost_center_spread_production_cost_center_id_idx" ON "acc_cost_center_spread"("production_cost_center_id");

ALTER TABLE "acc_cost_center_spread" ADD CONSTRAINT "acc_cost_center_spread_overhead_cost_center_id_fkey" FOREIGN KEY ("overhead_cost_center_id") REFERENCES "acc_cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acc_cost_center_spread" ADD CONSTRAINT "acc_cost_center_spread_production_cost_center_id_fkey" FOREIGN KEY ("production_cost_center_id") REFERENCES "acc_cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------- Workstation → Cost Center
-- Every existing workstation pools into PRODUKSI, the one Cost Center there
-- was (P154). It is created here only when a workstation needs it and the
-- seed has not made it yet.
INSERT INTO "acc_cost_center" ("cost_center_code", "cost_center_label", "cost_center_name", "created_by")
SELECT 'cc.' || LPAD((COALESCE(MAX(NULLIF(SPLIT_PART("cost_center_code", '.', 2), '')::INTEGER), 0) + 1)::TEXT, 4, '0'),
       'PRODUKSI', 'Produksi',
       COALESCE((SELECT "id" FROM "sys_user" WHERE "email" = 'sistem@erp.app'), 0)
FROM "acc_cost_center"
HAVING EXISTS (SELECT 1 FROM "ref_workstation")
   AND NOT EXISTS (SELECT 1 FROM "acc_cost_center" WHERE UPPER("cost_center_label") = 'PRODUKSI');

ALTER TABLE "ref_workstation" ADD COLUMN "cost_center_id" INTEGER;
UPDATE "ref_workstation"
SET "cost_center_id" = (SELECT "id" FROM "acc_cost_center" WHERE UPPER("cost_center_label") = 'PRODUKSI' ORDER BY "id" LIMIT 1);
ALTER TABLE "ref_workstation" ALTER COLUMN "cost_center_id" SET NOT NULL;

CREATE INDEX "ref_workstation_cost_center_id_idx" ON "ref_workstation"("cost_center_id");
ALTER TABLE "ref_workstation" ADD CONSTRAINT "ref_workstation_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "acc_cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------- Tarif Standar
CREATE TABLE "ref_workstation_rate" (
    "id" SERIAL NOT NULL,
    "rate_code" TEXT NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "effective_period_id" INTEGER NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_workstation_rate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ref_workstation_rate_rate_check" CHECK ("rate" >= 0)
);

CREATE UNIQUE INDEX "ref_workstation_rate_rate_code_key" ON "ref_workstation_rate"("rate_code");
CREATE UNIQUE INDEX "ref_workstation_rate_workstation_id_effective_period_id_key" ON "ref_workstation_rate"("workstation_id", "effective_period_id");
CREATE INDEX "ref_workstation_rate_effective_period_id_idx" ON "ref_workstation_rate"("effective_period_id");

ALTER TABLE "ref_workstation_rate" ADD CONSTRAINT "ref_workstation_rate_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ref_workstation_rate" ADD CONSTRAINT "ref_workstation_rate_effective_period_id_fkey" FOREIGN KEY ("effective_period_id") REFERENCES "acc_fiscal_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
