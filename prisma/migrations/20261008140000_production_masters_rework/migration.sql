-- Production Phase 1 rework (P150, M53, M54).
--
-- 1. Account Kategori Item becomes a mapping list: one row per category and
--    kind of account, instead of three fixed columns. Existing choices are
--    kept, each non-empty column becoming one row; nothing that posted
--    changes, because the readers return the same accounts.
-- 2. Elemen Biaya Produksi gains its own Label and Nama and loses the fixed
--    group list; several elements may name one account.

CREATE TYPE "ItemAccountKind" AS ENUM ('Inventory', 'Cogs', 'Expense', 'Wip');

CREATE TEMP TABLE "category_account_before" AS SELECT * FROM "acc_item_category_account";

ALTER TABLE "acc_item_category_account" DROP CONSTRAINT "acc_item_category_account_cogs_account_id_fkey";
ALTER TABLE "acc_item_category_account" DROP CONSTRAINT "acc_item_category_account_expense_account_id_fkey";
ALTER TABLE "acc_item_category_account" DROP CONSTRAINT "acc_item_category_account_inventory_account_id_fkey";
DROP INDEX "acc_item_category_account_category_id_key";

DELETE FROM "acc_item_category_account";

ALTER TABLE "acc_item_category_account" DROP COLUMN "cogs_account_id",
DROP COLUMN "expense_account_id",
DROP COLUMN "inventory_account_id",
ADD COLUMN     "account_id" INTEGER NOT NULL,
ADD COLUMN     "account_kind" "ItemAccountKind" NOT NULL,
ADD COLUMN     "mapping_code" TEXT NOT NULL,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "status" "ActiveStatus" NOT NULL DEFAULT 'Active';

INSERT INTO "acc_item_category_account"
  ("mapping_code", "category_id", "account_kind", "account_id", "created_by", "updated_by", "created_at", "updated_at")
SELECT 'ica.' || lpad(row_number() OVER (ORDER BY u.category_id, u.ord)::text, 4, '0'),
       u.category_id, u.kind::"ItemAccountKind", u.account_id, u.created_by, u.updated_by, u.created_at, u.updated_at
FROM (
  SELECT category_id, 1 AS ord, 'Inventory' AS kind, inventory_account_id AS account_id, created_by, updated_by, created_at, updated_at
    FROM "category_account_before" WHERE inventory_account_id IS NOT NULL
  UNION ALL
  SELECT category_id, 2, 'Cogs', cogs_account_id, created_by, updated_by, created_at, updated_at
    FROM "category_account_before" WHERE cogs_account_id IS NOT NULL
  UNION ALL
  SELECT category_id, 3, 'Expense', expense_account_id, created_by, updated_by, created_at, updated_at
    FROM "category_account_before" WHERE expense_account_id IS NOT NULL
) u;

DROP TABLE "category_account_before";

CREATE UNIQUE INDEX "acc_item_category_account_mapping_code_key" ON "acc_item_category_account"("mapping_code");
CREATE INDEX "acc_item_category_account_account_id_idx" ON "acc_item_category_account"("account_id");
CREATE UNIQUE INDEX "acc_item_category_account_category_id_account_kind_key" ON "acc_item_category_account"("category_id", "account_kind");
ALTER TABLE "acc_item_category_account" ADD CONSTRAINT "acc_item_category_account_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "acc_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Elemen Biaya Produksi: an element made before this keeps its account and is
-- named after it, its label taken from its code; the user may rename both.
ALTER TABLE "acc_production_cost_element" ADD COLUMN "element_label" TEXT, ADD COLUMN "element_name" TEXT;
UPDATE "acc_production_cost_element" e
   SET "element_label" = upper(replace(e."element_code", '.', '-')),
       "element_name"  = a."account_name"
  FROM "acc_account" a
 WHERE a."id" = e."account_id";
ALTER TABLE "acc_production_cost_element" ALTER COLUMN "element_label" SET NOT NULL, ALTER COLUMN "element_name" SET NOT NULL;
ALTER TABLE "acc_production_cost_element" DROP COLUMN "element_group";
DROP TYPE "ProductionCostGroup";
DROP INDEX "acc_production_cost_element_account_id_key";
CREATE INDEX "acc_production_cost_element_account_id_idx" ON "acc_production_cost_element"("account_id");
