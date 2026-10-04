-- P101: a Faktur Pajak is an internal record, complete from the posting that
-- made it. It has no upload lifecycle; the NSFP is an optional reference the
-- user fills in and may correct. Existing NSFPs and upload dates are kept.

-- DropIndex
DROP INDEX "tax_faktur_status_tax_date_idx";

-- AlterTable: keep what was recorded, under names that say what it is
ALTER TABLE "tax_faktur" RENAME COLUMN "reported_date" TO "nsfp_date";
ALTER TABLE "tax_faktur" RENAME COLUMN "reported_by" TO "nsfp_by";
ALTER TABLE "tax_faktur" DROP COLUMN "status";

-- DropEnum
DROP TYPE "TaxFakturStatus";

-- CreateIndex
CREATE INDEX "tax_faktur_tax_date_idx" ON "tax_faktur"("tax_date");

-- The permission now fills in or corrects the NSFP; renamed in place so role grants stay.
UPDATE "sys_permission" SET "permission_code" = 'TAX_FAKTUR_EDIT' WHERE "permission_code" = 'TAX_FAKTUR_UPLOAD';
