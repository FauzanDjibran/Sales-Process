-- P116, P117: an AR item keeps balances only. It records what it was born at
-- (original_amount) beside its current balance; its tax figures and NSFP are
-- the tax document's, so the tax columns go. An Invoice's item is born at its
-- face and lowered by the Uang Muka it deducts (event AdvanceApplied).
ALTER TYPE "ArEvent" ADD VALUE 'AdvanceApplied';

ALTER TABLE "fin_ar_item" ADD COLUMN "original_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
UPDATE "fin_ar_item" i SET "original_amount" = e."amount"
FROM "fin_ar_ledger" e WHERE e."item_id" = i."id" AND e."event" = 'Create';

ALTER TABLE "fin_ar_item" DROP COLUMN "tax_dpp";
ALTER TABLE "fin_ar_item" DROP COLUMN "tax_dpp_other";
ALTER TABLE "fin_ar_item" DROP COLUMN "tax_ppn";
ALTER TABLE "fin_ar_item" DROP COLUMN "tax_invoice_no";
