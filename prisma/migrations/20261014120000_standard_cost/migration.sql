-- Production Phase 5a reworked (P160; production_project.md M107–M110), after
-- the user's review of P159 against SAP, D365 and NetSuite:
--
-- * A Cost Center is an entity with a category, Produksi / Non-Produksi. Which
--   one is the overhead is a System Default; its spread is Rata. The P159
--   types, the spread method and the spread table go.
-- * Standard Cost Items, each crediting its own account, replace the one
--   global Biaya Produksi Dibebankan; a Standard Cost per workstation and
--   period lists their rates, replacing the single Tarif Standar.
-- * Jenis Biaya names the Standard Cost Item it is absorbed under.

-- ------------------------------------------------- Cost Center category
CREATE TYPE "CostCenterCategory" AS ENUM ('Production', 'NonProduction');

ALTER TABLE "acc_cost_center" ADD COLUMN "cost_center_category" "CostCenterCategory" NOT NULL DEFAULT 'Production';
UPDATE "acc_cost_center" SET "cost_center_category" = 'NonProduction' WHERE "cost_center_type"::TEXT = 'Administrative';

-- The overhead was a type; it becomes the System Default naming it. The
-- first Overhead Cost Center keeps the role, unless one is already set.
INSERT INTO "sys_setting" ("setting_key", "setting_value", "updated_by")
SELECT 'production_overhead_cost_center', "id"::TEXT, "created_by"
FROM "acc_cost_center"
WHERE "cost_center_type"::TEXT = 'Overhead'
ORDER BY "id"
LIMIT 1
ON CONFLICT ("setting_key") DO NOTHING;

DROP TABLE "acc_cost_center_spread";
ALTER TABLE "acc_cost_center" DROP COLUMN "spread_method";
ALTER TABLE "acc_cost_center" DROP COLUMN "cost_center_type";
DROP TYPE "CostCenterSpreadMethod";
DROP TYPE "CostCenterType";

-- Each Standard Cost Item credits its own account now.
DELETE FROM "sys_setting" WHERE "setting_key" = 'production_absorbed_account';

-- --------------------------------------------- Tarif Standar → Standard Cost
DROP TABLE "ref_workstation_rate";

UPDATE "sys_permission" SET "permission_code" = REPLACE("permission_code", 'STANDARD_RATE_', 'STANDARD_COST_')
WHERE "permission_code" LIKE 'STANDARD\_RATE\_%';

CREATE TABLE "acc_standard_cost_item" (
    "id" SERIAL NOT NULL,
    "item_code" TEXT NOT NULL,
    "item_label" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_standard_cost_item_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "acc_standard_cost_item_item_code_key" ON "acc_standard_cost_item"("item_code");
CREATE INDEX "acc_standard_cost_item_account_id_idx" ON "acc_standard_cost_item"("account_id");
ALTER TABLE "acc_standard_cost_item" ADD CONSTRAINT "acc_standard_cost_item_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "acc_standard_cost" (
    "id" SERIAL NOT NULL,
    "standard_cost_code" TEXT NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "effective_period_id" INTEGER NOT NULL,
    "note" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_standard_cost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "acc_standard_cost_standard_cost_code_key" ON "acc_standard_cost"("standard_cost_code");
CREATE UNIQUE INDEX "acc_standard_cost_workstation_id_effective_period_id_key" ON "acc_standard_cost"("workstation_id", "effective_period_id");
CREATE INDEX "acc_standard_cost_effective_period_id_idx" ON "acc_standard_cost"("effective_period_id");
ALTER TABLE "acc_standard_cost" ADD CONSTRAINT "acc_standard_cost_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acc_standard_cost" ADD CONSTRAINT "acc_standard_cost_effective_period_id_fkey" FOREIGN KEY ("effective_period_id") REFERENCES "acc_fiscal_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "acc_standard_cost_line" (
    "id" SERIAL NOT NULL,
    "standard_cost_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_standard_cost_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "acc_standard_cost_line_rate_check" CHECK ("rate" >= 0)
);
CREATE UNIQUE INDEX "acc_standard_cost_line_standard_cost_id_item_id_key" ON "acc_standard_cost_line"("standard_cost_id", "item_id");
CREATE INDEX "acc_standard_cost_line_item_id_idx" ON "acc_standard_cost_line"("item_id");
ALTER TABLE "acc_standard_cost_line" ADD CONSTRAINT "acc_standard_cost_line_standard_cost_id_fkey" FOREIGN KEY ("standard_cost_id") REFERENCES "acc_standard_cost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acc_standard_cost_line" ADD CONSTRAINT "acc_standard_cost_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "acc_standard_cost_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------- Jenis Biaya → Standard Cost Item
ALTER TABLE "acc_cost_type" ADD COLUMN "standard_cost_item_id" INTEGER;
CREATE INDEX "acc_cost_type_standard_cost_item_id_idx" ON "acc_cost_type"("standard_cost_item_id");
ALTER TABLE "acc_cost_type" ADD CONSTRAINT "acc_cost_type_standard_cost_item_id_fkey" FOREIGN KEY ("standard_cost_item_id") REFERENCES "acc_standard_cost_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
