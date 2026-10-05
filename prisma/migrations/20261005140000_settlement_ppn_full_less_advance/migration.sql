-- P113 (tax concept choice point settlement-ppn = full-less-advance): an
-- Invoice's lines carry PPN on their full DPP, and the PPN of the Uang Muka it
-- uses is deducted once, at header level. Invoices posted before keep the
-- figures they were posted with (net-dpp): their advance PPN is 0 and their
-- lines already carry the PPN on the net DPP, so ppn = Σ lines − advance PPN
-- holds for both.
ALTER TABLE "fin_ar_invoice" ADD COLUMN "advance_ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_ar_invoice_advance_deduction" ADD COLUMN "ppn_used" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "tax_faktur" ADD COLUMN "advance_ppn" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "tax_faktur_ref" ADD COLUMN "ppn_deducted" DECIMAL(18,2) NOT NULL DEFAULT 0;
