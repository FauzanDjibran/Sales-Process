-- P151: a Tagihan Biaya Produksi no longer takes a hand-picked Account Lawan.
-- Every bill is owed to its Supplier and credits Account Mapping's Hutang
-- Biaya Produksi, copied onto the bill at posting so its payment debits the
-- same account even if the mapping changes later.

ALTER TABLE "prd_cost_bill" ADD COLUMN "payable_account_id" INTEGER;

-- A bill posted on the payable keeps it; a Draft takes the mapping at
-- posting; a bill posted before P151 to another lawan (depreciation, wages)
-- stays as posted and is never payable (payable_account_id null).
UPDATE "prd_cost_bill" SET "payable_account_id" = "contra_account_id"
 WHERE "status" = 'Posted' AND "is_payable";

ALTER TABLE "prd_cost_bill" DROP CONSTRAINT "prd_cost_bill_contra_account_id_fkey";
ALTER TABLE "prd_cost_bill" DROP COLUMN "contra_account_id",
DROP COLUMN "is_payable";

ALTER TABLE "prd_cost_bill" ADD CONSTRAINT "prd_cost_bill_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
