-- The books store no running balance: an entry may be backdated in among
-- entries written before it, so a balance "after" it followed write order, not
-- date, and nothing read it. A balance on a date is summed from movements.
ALTER TABLE "cash_bank_ledger" DROP COLUMN "balance_after", DROP COLUMN "base_balance_after";
ALTER TABLE "fin_ar_ledger" DROP COLUMN "balance_after";
ALTER TABLE "fin_ap_ledger" DROP COLUMN "balance_after";

-- Every table is keyed by id; this was the last one keyed otherwise, and its
-- natural key stays unique, so every query addressing it is unchanged.
ALTER TABLE "cash_bank_balance" DROP CONSTRAINT "cash_bank_balance_pkey",
  ADD COLUMN "id" SERIAL NOT NULL,
  ADD CONSTRAINT "cash_bank_balance_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "cash_bank_balance_cash_bank_id_key" ON "cash_bank_balance"("cash_bank_id");
