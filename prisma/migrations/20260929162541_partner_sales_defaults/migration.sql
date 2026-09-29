-- CreateEnum
CREATE TYPE "PriceMode" AS ENUM ('Exclude', 'Include');

-- AlterTable
ALTER TABLE "m_partner" ADD COLUMN     "default_price_mode" "PriceMode",
ADD COLUMN     "default_term_id" INTEGER;

-- AddForeignKey
ALTER TABLE "m_partner" ADD CONSTRAINT "m_partner_default_term_id_fkey" FOREIGN KEY ("default_term_id") REFERENCES "ref_payment_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;
