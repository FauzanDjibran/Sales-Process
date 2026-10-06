-- P122: the masters purchasing needs (Purchasing-Concept.md B1–B5a).

-- 1. Jenis PPh: a usage, and its one account renamed in place (P122). Every
--    existing row is a sales Jenis PPh; its account is the prepaid asset.
CREATE TYPE "WhtUsage" AS ENUM ('Sales', 'Purchase');
ALTER TABLE "ref_withholding_tax" ADD COLUMN "usage" "WhtUsage" NOT NULL DEFAULT 'Sales';
ALTER TABLE "ref_withholding_tax" RENAME COLUMN "prepaid_account_id" TO "account_id";
ALTER TABLE "ref_withholding_tax" RENAME CONSTRAINT "ref_withholding_tax_prepaid_account_id_fkey" TO "ref_withholding_tax_account_id_fkey";
ALTER INDEX "ref_withholding_tax_prepaid_account_id_idx" RENAME TO "ref_withholding_tax_account_id_idx";
CREATE INDEX "ref_withholding_tax_usage_idx" ON "ref_withholding_tax"("usage");

-- 2. Supplier is switched on (B1; P41 kept it Inactive for purchasing).
UPDATE "sys_partner_category" SET "status" = 'Active' WHERE "category_label" = 'Supplier';

-- 3. A supplier's purchase defaults (B2).
ALTER TABLE "m_partner" ADD COLUMN "purchase_term_id" INTEGER,
ADD COLUMN "purchase_price_mode" "PriceMode";
ALTER TABLE "m_partner" ADD CONSTRAINT "m_partner_purchase_term_id_fkey" FOREIGN KEY ("purchase_term_id") REFERENCES "ref_payment_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Accounts per Kategori Item (B5a, closes C25).
CREATE TABLE "acc_item_category_account" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER NOT NULL,
    "inventory_account_id" INTEGER,
    "cogs_account_id" INTEGER,
    "expense_account_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acc_item_category_account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "acc_item_category_account_category_id_key" ON "acc_item_category_account"("category_id");
ALTER TABLE "acc_item_category_account" ADD CONSTRAINT "acc_item_category_account_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "sys_item_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acc_item_category_account" ADD CONSTRAINT "acc_item_category_account_inventory_account_id_fkey" FOREIGN KEY ("inventory_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "acc_item_category_account" ADD CONSTRAINT "acc_item_category_account_cogs_account_id_fkey" FOREIGN KEY ("cogs_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "acc_item_category_account" ADD CONSTRAINT "acc_item_category_account_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
