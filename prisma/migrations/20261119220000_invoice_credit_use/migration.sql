-- AlterTable
ALTER TABLE "fin_ar_invoice" ADD COLUMN     "credit_used_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "fin_ar_invoice_credit_use" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "ar_item_id" INTEGER NOT NULL,
    "ar_item_no" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "invoice_base_amount" DECIMAL(18,2) NOT NULL,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fin_ar_invoice_credit_use_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_ar_invoice_credit_use_ar_item_id_idx" ON "fin_ar_invoice_credit_use"("ar_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_invoice_credit_use_invoice_id_ar_item_id_key" ON "fin_ar_invoice_credit_use"("invoice_id", "ar_item_id");

-- AddForeignKey
ALTER TABLE "fin_ar_invoice_credit_use" ADD CONSTRAINT "fin_ar_invoice_credit_use_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "fin_ar_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Credit used is never negative nor more than the Invoice asks (P295).
ALTER TABLE "fin_ar_invoice" ADD CONSTRAINT "fin_ar_invoice_credit_used_check" CHECK ("credit_used_amount" >= 0 AND "credit_used_amount" <= "total_amount");
ALTER TABLE "fin_ar_invoice_credit_use" ADD CONSTRAINT "fin_ar_invoice_credit_use_amount_check" CHECK ("amount" > 0);
