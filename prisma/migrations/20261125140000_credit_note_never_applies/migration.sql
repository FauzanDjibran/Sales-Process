-- A Credit Note never lowers its Invoice itself (P330). What notes posted before
-- applied stays in Buku Piutang (ReturnUsed / ReturnApplied).

-- AlterTable (the CHECKs on the columns go with them)
ALTER TABLE "fin_ar_credit_note" DROP COLUMN "apply_to_invoice",
DROP COLUMN "applied_amount",
DROP COLUMN "fx_difference";
