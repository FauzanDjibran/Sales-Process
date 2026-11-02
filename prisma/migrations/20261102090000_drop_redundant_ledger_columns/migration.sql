-- P213: a ledger keeps one signed movement per figure (+ grows, − falls);
-- its direction, absolute amount and unit costs are read from it, never stored.

-- Cash Bank Book: direction and amount were the sign and size of movement.
ALTER TABLE "cash_bank_ledger" DROP COLUMN "direction",
DROP COLUMN "amount",
DROP COLUMN "base_amount";

-- Never read.
ALTER TABLE "cash_bank_balance" DROP COLUMN "last_entry_id";

-- Buku Piutang / Buku Hutang: amount was |movement|.
ALTER TABLE "fin_ar_ledger" DROP COLUMN "amount";
ALTER TABLE "fin_ap_ledger" DROP COLUMN "amount";

-- Unit cost and average: value ÷ quantity of the same row.
ALTER TABLE "log_stock_ledger" DROP COLUMN "unit_cost";
ALTER TABLE "log_stock_valuation_ledger" DROP COLUMN "unit_cost",
DROP COLUMN "avg_unit_cost";
ALTER TABLE "log_stock_valuation_balance" DROP COLUMN "avg_unit_cost";
ALTER TABLE "prd_ledger" DROP COLUMN "unit_cost";
