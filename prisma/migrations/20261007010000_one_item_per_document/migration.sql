-- One document, one item (P133). An advance bill has one Uang Muka item,
-- raised by each later payment; an Invoice keeps what it was paid.
--
-- No data is converted: the database is reset (the user's consent, D5). The
-- unique indexes below refuse to build on data with two Uang Muka items on one
-- bill, so an un-reset database stops here instead of half-changing.

-- AlterEnum
ALTER TYPE "ArEvent" ADD VALUE 'AdvanceReceived';

-- AlterTable
ALTER TABLE "fin_ap_invoice" ADD COLUMN     "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fin_ar_invoice" ADD COLUMN     "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Never negative, never beyond what the Invoice leaves to pay.
ALTER TABLE "fin_ar_invoice" ADD CONSTRAINT "fin_ar_invoice_paid_within_total" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
ALTER TABLE "fin_ap_invoice" ADD CONSTRAINT "fin_ap_invoice_paid_within_owed" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "payable_amount" - "advance_dpp_amount" - "advance_ppn_amount");

-- One Uang Muka item per advance bill (its source).
CREATE UNIQUE INDEX "fin_ar_item_one_advance_per_source" ON "fin_ar_item" ("source_doc_type_id", "source_doc_id") WHERE "item_type" = 'Advance';
CREATE UNIQUE INDEX "fin_ap_item_one_advance_per_source" ON "fin_ap_item" ("source_doc_type_id", "source_doc_id") WHERE "item_type" = 'Advance';
