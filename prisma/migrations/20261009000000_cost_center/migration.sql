-- P154 (production_project.md §21e): the Cost Center joins the journal line,
-- Elemen Biaya Produksi becomes Jenis Biaya with its own credit account, and
-- the separate cost ledger is dropped — production cost is the GL's, tagged by
-- Cost Center.

-- ---------------------------------------------------------- Cost Center
CREATE TYPE "CostCenterType" AS ENUM ('Production');

CREATE TABLE "acc_cost_center" (
    "id" SERIAL NOT NULL,
    "cost_center_code" TEXT NOT NULL,
    "cost_center_label" TEXT NOT NULL,
    "cost_center_name" TEXT NOT NULL,
    "cost_center_type" "CostCenterType" NOT NULL DEFAULT 'Production',
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "acc_cost_center_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "acc_cost_center_cost_center_code_key" ON "acc_cost_center"("cost_center_code");

-- PRODUKSI, the one cost center today. Created here only when posted data needs
-- it; a fresh installation gets it from the seed (P62 style).
INSERT INTO "acc_cost_center" ("cost_center_code", "cost_center_label", "cost_center_name", "created_by")
SELECT 'cc.0001', 'PRODUKSI', 'Produksi',
       COALESCE((SELECT "id" FROM "sys_user" WHERE "email" = 'sistem@erp.app'), 0)
WHERE EXISTS (SELECT 1 FROM "prd_cost_bill_line");

-- ------------------------------------------------------- account and line
ALTER TABLE "acc_account" ADD COLUMN "require_cost_center" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "acc_journal_line" ADD COLUMN "cost_center_id" INTEGER;
CREATE INDEX "acc_journal_line_cost_center_id_account_id_idx" ON "acc_journal_line"("cost_center_id", "account_id");
ALTER TABLE "acc_journal_line" ADD CONSTRAINT "acc_journal_line_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "acc_cost_center"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------- Elemen Biaya Produksi → Jenis Biaya
ALTER TABLE "acc_production_cost_element" RENAME TO "acc_cost_type";
ALTER TABLE "acc_cost_type" RENAME COLUMN "element_code" TO "cost_type_code";
ALTER TABLE "acc_cost_type" RENAME COLUMN "element_label" TO "cost_type_label";
ALTER TABLE "acc_cost_type" RENAME COLUMN "element_name" TO "cost_type_name";
ALTER TABLE "acc_cost_type" RENAME COLUMN "account_id" TO "expense_account_id";
ALTER TABLE "acc_cost_type" RENAME CONSTRAINT "acc_production_cost_element_pkey" TO "acc_cost_type_pkey";
ALTER TABLE "acc_cost_type" RENAME CONSTRAINT "acc_production_cost_element_account_id_fkey" TO "acc_cost_type_expense_account_id_fkey";
ALTER INDEX "acc_production_cost_element_element_code_key" RENAME TO "acc_cost_type_cost_type_code_key";
ALTER INDEX "acc_production_cost_element_account_id_idx" RENAME TO "acc_cost_type_expense_account_id_idx";
ALTER SEQUENCE "acc_production_cost_element_id_seq" RENAME TO "acc_cost_type_id_seq";
UPDATE "acc_cost_type" SET "cost_type_code" = 'jb.' || SPLIT_PART("cost_type_code", '.', 2);
ALTER TABLE "acc_cost_type" ADD COLUMN "contra_account_id" INTEGER,
                            ADD COLUMN "is_payable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "acc_cost_type" ADD CONSTRAINT "acc_cost_type_contra_account_id_fkey" FOREIGN KEY ("contra_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Every existing element was paid on Hutang Biaya Produksi (P151).
UPDATE "acc_cost_type" SET "contra_account_id" = NULLIF(s."setting_value", '')::INTEGER
FROM "sys_setting" s WHERE s."setting_key" = 'production_cost_payable_account';
-- The accounts the cost types book to carry a Cost Center from now on (M88).
UPDATE "acc_account" SET "require_cost_center" = true
WHERE "id" IN (SELECT "expense_account_id" FROM "acc_cost_type");

-- ------------------------------------------------------ Tagihan Biaya lines
ALTER TABLE "prd_cost_bill_line" RENAME COLUMN "element_id" TO "cost_type_id";
ALTER TABLE "prd_cost_bill_line" RENAME CONSTRAINT "prd_cost_bill_line_element_id_fkey" TO "prd_cost_bill_line_cost_type_id_fkey";
ALTER TABLE "prd_cost_bill_line" ADD COLUMN "cost_center_id" INTEGER,
                                 ADD COLUMN "credit_account_id" INTEGER;
UPDATE "prd_cost_bill_line" SET "cost_center_id" = (SELECT "id" FROM "acc_cost_center" WHERE "cost_center_code" = 'cc.0001');
UPDATE "prd_cost_bill_line" l SET "credit_account_id" = b."payable_account_id"
FROM "prd_cost_bill" b WHERE b."id" = l."bill_id" AND b."status" = 'Posted';
ALTER TABLE "prd_cost_bill_line" ALTER COLUMN "cost_center_id" SET NOT NULL;
ALTER TABLE "prd_cost_bill_line" ADD CONSTRAINT "prd_cost_bill_line_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "acc_cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_cost_bill_line" ADD CONSTRAINT "prd_cost_bill_line_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A posted bill's debit lines are on its cost types' accounts: tag them.
UPDATE "acc_journal_line" jl SET "cost_center_id" = (SELECT "id" FROM "acc_cost_center" WHERE "cost_center_code" = 'cc.0001')
FROM "prd_cost_bill" b
WHERE jl."journal_id" = b."journal_id" AND b."status" = 'Posted' AND jl."debit_amount" > 0;

-- -------------------------------------------------- the cost ledger goes
DROP TABLE "prd_cost_ledger";
DROP TYPE "ProductionCostKind";

-- ------------------------------------------------ permissions and names
UPDATE "sys_permission" SET "permission_code" = REPLACE("permission_code", 'PRODUCTION_COST_ELEMENT_', 'COST_TYPE_')
WHERE "permission_code" LIKE 'PRODUCTION_COST_ELEMENT_%';
UPDATE "sys_permission" SET "permission_code" = 'REPORT_COST_CENTER_VIEW'
WHERE "permission_code" = 'REPORT_PRODUCTION_COST_LEDGER_VIEW';
DELETE FROM "sys_role_permission" WHERE "permission_id" IN (
  SELECT "id" FROM "sys_permission" WHERE "permission_code" = 'REPORT_PRODUCTION_COST_BALANCE_VIEW');
DELETE FROM "sys_permission" WHERE "permission_code" = 'REPORT_PRODUCTION_COST_BALANCE_VIEW';
UPDATE "sys_doc_type" SET "doc_name" = 'Tagihan Biaya' WHERE "doc_table" = 'prd_cost_bill';
UPDATE "audit_log" SET "entity_key" = 'acc_cost_type' WHERE "entity_key" = 'acc_production_cost_element';
