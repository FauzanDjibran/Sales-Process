-- P156: every Tagihan Biaya credits one account, Account Mapping's
-- Hutang Biaya Produksi (back to P151). A Jenis Biaya names only its expense
-- account; the per-type credit account, the paid flag and the per-line credit
-- copy (P154 M84, M89) go. Posted bills keep their journals and
-- payable_account_id; a bill posted to a not-paid Jenis Biaya stays unpayable.

-- Keep the mapping when it was emptied after P154: fill it from the credit
-- account of a paid Jenis Biaya, the one most of them used.
INSERT INTO "sys_setting" ("setting_key", "setting_value", "updated_at")
SELECT 'production_cost_payable_account', x."contra_account_id"::TEXT, CURRENT_TIMESTAMP
FROM (
  SELECT "contra_account_id" FROM "acc_cost_type"
  WHERE "is_payable" AND "contra_account_id" IS NOT NULL
  GROUP BY "contra_account_id" ORDER BY COUNT(*) DESC, "contra_account_id" LIMIT 1
) x
ON CONFLICT ("setting_key") DO UPDATE SET "setting_value" = EXCLUDED."setting_value", "updated_at" = CURRENT_TIMESTAMP
WHERE "sys_setting"."setting_value" IS NULL OR "sys_setting"."setting_value" = '';

-- DropForeignKey
ALTER TABLE "acc_cost_type" DROP CONSTRAINT "acc_cost_type_contra_account_id_fkey";

-- DropForeignKey
ALTER TABLE "prd_cost_bill_line" DROP CONSTRAINT "prd_cost_bill_line_credit_account_id_fkey";

-- AlterTable
ALTER TABLE "acc_cost_type" DROP COLUMN "contra_account_id",
DROP COLUMN "is_payable";

-- AlterTable
ALTER TABLE "prd_cost_bill_line" DROP COLUMN "credit_account_id";
