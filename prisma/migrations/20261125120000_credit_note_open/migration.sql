-- A Credit Note is open customer credit (P329, SR11–SR15): it lowers its own
-- Invoice only when asked, and an Invoice no longer takes credit itself.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fin_ar_invoice" WHERE "credit_used_amount" <> 0)
     OR EXISTS (SELECT 1 FROM "fin_ar_invoice_credit_use") THEN
    RAISE EXCEPTION 'Ada Invoice yang memakai Kredit Retur (P295). Reset data transaksinya sebelum migrasi ini.';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "fin_ar_credit_note" ADD COLUMN     "apply_to_invoice" BOOLEAN NOT NULL DEFAULT false;

-- Notes posted before were applied to their Invoice as far as it went (P292).
UPDATE "fin_ar_credit_note" SET "apply_to_invoice" = true WHERE "status" = 'Posted';

-- A Credit Note not asked to never lowers its Invoice.
ALTER TABLE "fin_ar_credit_note" ADD CONSTRAINT "fin_ar_credit_note_apply_check" CHECK ("apply_to_invoice" OR "applied_amount" = 0);

-- DropTable
DROP TABLE "fin_ar_invoice_credit_use";

-- AlterTable (its CHECK goes with the column)
ALTER TABLE "fin_ar_invoice" DROP COLUMN "credit_used_amount";
