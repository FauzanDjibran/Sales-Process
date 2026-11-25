-- base_ in front, as every base-currency column (P331). Names only.
ALTER TABLE "fin_ar_credit_application_line" RENAME COLUMN "return_base_amount" TO "base_return_amount";
ALTER TABLE "fin_ar_credit_application_line" RENAME COLUMN "invoice_base_amount" TO "base_invoice_amount";
