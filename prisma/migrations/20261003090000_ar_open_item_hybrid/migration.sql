-- AlterEnum (PostgreSQL 18: several values in one migration is fine; none of
-- the new values is used by this migration's own statements).

ALTER TYPE "ArEvent" ADD VALUE 'Received';
ALTER TYPE "ArEvent" ADD VALUE 'Cancelled';

-- AlterEnum
ALTER TYPE "ArItemType" ADD VALUE 'AdvanceRequest';

-- The AR items change shape (Claude-ERP.md P87–P88): one item per document per
-- type, named after the document it is about, carrying DPP / PPN / PPh. The old
-- rows (one Uang Muka item per receipt, valued at DPP) cannot be reshaped in
-- SQL, because a Tagihan item's expected PPh comes from the tax module. They are
-- cleared here and rebuilt from the issued bills and posted receipts by
-- `npm run db:rebuild-ar` (scripts/rebuild-ar-items.ts), run once after this
-- migration. Development data only.
DELETE FROM "fin_ar_ledger";
DELETE FROM "fin_ar_item";

-- DropForeignKey
ALTER TABLE "fin_ar_item" DROP CONSTRAINT "fin_ar_item_ref_doc_type_id_fkey";

-- DropIndex
DROP INDEX "fin_ar_item_ref_doc_type_id_ref_doc_id_idx";

-- AlterTable
ALTER TABLE "fin_ar_item" DROP COLUMN "ref_doc_id",
DROP COLUMN "ref_doc_type_id",
DROP COLUMN "ref_no",
ADD COLUMN     "current_base_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "current_dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "current_pph" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "current_ppn" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fin_ar_ledger" ADD COLUMN     "base_movement" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dpp_movement" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pph_movement" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ppn_movement" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
ADD COLUMN     "source_entry_id" INTEGER;

-- AlterTable
ALTER TABLE "fin_cash_bank_tx" ADD COLUMN     "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1;

-- AlterTable
-- Every existing order is in the base currency at rate 1 (P92).
ALTER TABLE "sal_customer_order" ADD COLUMN     "currency_id" INTEGER,
ADD COLUMN     "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1;
UPDATE "sal_customer_order" SET "currency_id" = (SELECT "id" FROM "ref_currency" WHERE "currency_label" = 'IDR');
ALTER TABLE "sal_customer_order" ALTER COLUMN "currency_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "fin_ar_item_wht" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "withholding_tax_id" INTEGER NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "fin_ar_item_wht_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_item_wht_item_id_withholding_tax_id_key" ON "fin_ar_item_wht"("item_id", "withholding_tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_item_item_type_source_doc_type_id_source_doc_id_key" ON "fin_ar_item"("item_type", "source_doc_type_id", "source_doc_id");

-- AddForeignKey
ALTER TABLE "sal_customer_order" ADD CONSTRAINT "sal_customer_order_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_item_wht" ADD CONSTRAINT "fin_ar_item_wht_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "fin_ar_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_item_wht" ADD CONSTRAINT "fin_ar_item_wht_withholding_tax_id_fkey" FOREIGN KEY ("withholding_tax_id") REFERENCES "ref_withholding_tax"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_ledger" ADD CONSTRAINT "fin_ar_ledger_source_entry_id_fkey" FOREIGN KEY ("source_entry_id") REFERENCES "fin_ar_ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
