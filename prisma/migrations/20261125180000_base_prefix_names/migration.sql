-- base_ is the measure in the base currency, always in front; the basis a PPh is
-- worked out on is its DPP (Value-Naming-Plan.md, fase 2). Names only.
ALTER TABLE "fin_cash_bank_tx_line_wht" RENAME COLUMN "base_amount" TO "dpp_amount";
ALTER TABLE "tax_withholding_slip" RENAME COLUMN "base_amount" TO "dpp_amount";
ALTER TABLE "fin_cash_bank_tx_line" RENAME COLUMN "transaction_base_amount" TO "base_transaction_amount";
ALTER TABLE "fin_cash_bank_transfer" RENAME COLUMN "from_base" TO "base_from_amount";
ALTER TABLE "fin_cash_bank_transfer_line" RENAME COLUMN "out_base" TO "base_out_amount";
ALTER TABLE "fin_cash_bank_transfer_line" RENAME COLUMN "in_base" TO "base_in_amount";
