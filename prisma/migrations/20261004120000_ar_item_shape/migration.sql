-- U1 / U9: the AR item's source is the document it is about (the advance bill
-- for an Uang Muka), every item gets an ARI/YYYY/MM/NNNN number, and an item
-- carries its own tax document's figures. What created an item stays in its
-- Create entry, which already names the receipt.

ALTER TABLE "fin_ar_item"
ADD COLUMN     "ar_item_no" TEXT,
ADD COLUMN     "tax_dpp" DECIMAL(18,2),
ADD COLUMN     "tax_dpp_other" DECIMAL(18,2),
ADD COLUMN     "tax_invoice_no" TEXT,
ADD COLUMN     "tax_ppn" DECIMAL(18,2);

-- An Uang Muka item's tax figures are its Faktur Pajak Uang Muka: the DPP and
-- PPN parts its receipt line booked, and DPP Nilai Lain by the chain on that
-- DPP at the bill's snapshot (half up). A bill without PPN has none.
UPDATE "fin_ar_item" i
SET "tax_dpp" = l."dpp_part",
    "tax_ppn" = l."ppn_part",
    "tax_dpp_other" = ROUND(l."dpp_part" * a."ppn_dpp_other_numerator" / a."ppn_dpp_other_denominator", 0)
FROM "fin_cash_bank_tx_line" l, "sal_advance" a
WHERE i."item_type" = 'Advance'
  AND l."tx_id" = i."source_doc_id" AND l."doc_type_id" = i."ref_doc_type_id" AND l."doc_id" = i."ref_doc_id"
  AND a."id" = i."ref_doc_id"
  AND a."ppn_amount" > 0 AND a."ppn_dpp_other_numerator" IS NOT NULL AND a."ppn_dpp_other_denominator" > 0;

-- The source becomes what the item is about: the bill.
UPDATE "fin_ar_item"
SET "source_doc_type_id" = "ref_doc_type_id", "source_doc_id" = "ref_doc_id", "source_no" = "ref_no"
WHERE "item_type" = 'Advance' AND "ref_doc_id" IS NOT NULL;

-- Number existing items in the month of their date, oldest first.
UPDATE "fin_ar_item" i
SET "ar_item_no" = 'ARI/' || to_char(n."item_date", 'YYYY/MM') || '/' || lpad(n.seq::text, 4, '0')
FROM (
  SELECT "id", "item_date",
         row_number() OVER (PARTITION BY date_trunc('month', "item_date") ORDER BY "item_date", "id") AS seq
  FROM "fin_ar_item"
) n
WHERE n."id" = i."id";

ALTER TABLE "fin_ar_item" ALTER COLUMN "ar_item_no" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "fin_ar_item" DROP CONSTRAINT "fin_ar_item_ref_doc_type_id_fkey";

-- DropIndex
DROP INDEX "fin_ar_item_ref_doc_type_id_ref_doc_id_idx";

ALTER TABLE "fin_ar_item" DROP COLUMN "customer_order_no",
DROP COLUMN "ref_doc_id",
DROP COLUMN "ref_doc_type_id",
DROP COLUMN "ref_no";

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_item_ar_item_no_key" ON "fin_ar_item"("ar_item_no");
