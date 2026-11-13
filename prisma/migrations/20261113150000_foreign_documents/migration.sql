-- Multi-Currency-Plan stages 3-6 (§6.1): a Receipt Note line keeps its PO DPP in the
-- PO's currency beside the stock value in base, and an Uang Muka applied by an
-- Invoice keeps the selisih kurs it gave rise to.

ALTER TABLE "log_receipt_note_line" ADD COLUMN "order_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
-- Every receipt so far is rupiah at rate 1: its PO DPP share is its value.
UPDATE "log_receipt_note_line" SET "order_dpp_amount" = "value_amount";

ALTER TABLE "fin_ar_invoice_advance_deduction" ADD COLUMN "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_ap_invoice_advance_deduction" ADD COLUMN "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0;
