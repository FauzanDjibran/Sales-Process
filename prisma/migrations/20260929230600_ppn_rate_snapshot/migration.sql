-- AlterTable
ALTER TABLE "sal_advance" ADD COLUMN     "ppn_dpp_other_denominator" INTEGER,
ADD COLUMN     "ppn_dpp_other_numerator" INTEGER,
ADD COLUMN     "ppn_rate" DECIMAL(9,4);

-- AlterTable
ALTER TABLE "sal_order" ADD COLUMN     "ppn_dpp_other_denominator" INTEGER,
ADD COLUMN     "ppn_dpp_other_numerator" INTEGER,
ADD COLUMN     "ppn_rate" DECIMAL(9,4);

-- AlterTable
ALTER TABLE "sal_order_line" ADD COLUMN     "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Documents saved before the rate became a setting (P60) were computed at
-- 12 % on 11/12, which is what the new snapshot records for them. Their
-- stored figures are left as they were computed.
UPDATE "sal_order" SET "ppn_rate" = 12, "ppn_dpp_other_numerator" = 11, "ppn_dpp_other_denominator" = 12 WHERE "is_taxable";
UPDATE "sal_advance" SET "ppn_rate" = 12, "ppn_dpp_other_numerator" = 11, "ppn_dpp_other_denominator" = 12 WHERE "is_taxable";
