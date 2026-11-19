-- P292 (Sales-Return-Plan step 4): the Credit Note Penjualan, crediting what came
-- back of a posted Invoice, and the Retur AR item it leaves as customer credit.

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ArEvent" ADD VALUE 'ReturnApplied';
ALTER TYPE "ArEvent" ADD VALUE 'ReturnUsed';

-- AlterEnum
ALTER TYPE "ArItemType" ADD VALUE 'Return';

-- CreateTable
CREATE TABLE "fin_ar_credit_note" (
    "id" SERIAL NOT NULL,
    "credit_no" TEXT NOT NULL,
    "credit_date" DATE NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'Draft',
    "invoice_id" INTEGER NOT NULL,
    "customer_order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "is_taxable" BOOLEAN NOT NULL,
    "customer_return_no" TEXT,
    "note" TEXT,
    "gross_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "applied_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ar_item_id" INTEGER,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ar_credit_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_ar_credit_note_line" (
    "id" SERIAL NOT NULL,
    "credit_note_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "invoice_line_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "gross_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dpp_other_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_dpp_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_ppn_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fin_ar_credit_note_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_credit_note_credit_no_key" ON "fin_ar_credit_note"("credit_no");

-- CreateIndex
CREATE INDEX "fin_ar_credit_note_invoice_id_idx" ON "fin_ar_credit_note"("invoice_id");

-- CreateIndex
CREATE INDEX "fin_ar_credit_note_status_credit_date_idx" ON "fin_ar_credit_note"("status", "credit_date");

-- CreateIndex
CREATE INDEX "fin_ar_credit_note_line_invoice_line_id_idx" ON "fin_ar_credit_note_line"("invoice_line_id");

-- CreateIndex
CREATE INDEX "fin_ar_credit_note_line_item_id_idx" ON "fin_ar_credit_note_line"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_credit_note_line_credit_note_id_line_no_key" ON "fin_ar_credit_note_line"("credit_note_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_credit_note_line_credit_note_id_invoice_line_id_key" ON "fin_ar_credit_note_line"("credit_note_id", "invoice_line_id");

-- AddForeignKey
ALTER TABLE "fin_ar_credit_note" ADD CONSTRAINT "fin_ar_credit_note_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "fin_ar_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_credit_note" ADD CONSTRAINT "fin_ar_credit_note_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_credit_note" ADD CONSTRAINT "fin_ar_credit_note_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_credit_note_line" ADD CONSTRAINT "fin_ar_credit_note_line_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "fin_ar_credit_note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_credit_note_line" ADD CONSTRAINT "fin_ar_credit_note_line_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "fin_ar_invoice_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_credit_note_line" ADD CONSTRAINT "fin_ar_credit_note_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A credited line credits something; a note's figures never go below nothing.
ALTER TABLE "fin_ar_credit_note_line" ADD CONSTRAINT "fin_ar_credit_note_line_qty_positive" CHECK ("qty" > 0);
ALTER TABLE "fin_ar_credit_note" ADD CONSTRAINT "fin_ar_credit_note_applied_within" CHECK ("applied_amount" >= 0 AND "applied_amount" <= "total_amount");

-- Its menu and permissions, given to every role that may do the same to an
-- Invoice Penjualan: a credit note is its correction.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('SALES_CREDIT_NOTE_VIEW', 'Lihat Credit Note Penjualan', 'finance', 'Termasuk yang masih Draft dan yang dibatalkan.', now()),
  ('SALES_CREDIT_NOTE_CREATE', 'Buat Credit Note Penjualan', 'finance', 'Dari Invoice Penjualan yang barangnya sudah diterima kembali.', now()),
  ('SALES_CREDIT_NOTE_EDIT', 'Ubah Credit Note Penjualan', 'finance', 'Hanya selama masih Draft.', now()),
  ('SALES_CREDIT_NOTE_POST', 'Posting Credit Note Penjualan', 'finance', 'Mengurangi penjualan, PPN Keluaran dan piutang.', now()),
  ('SALES_CREDIT_NOTE_CANCEL', 'Batalkan Credit Note Penjualan', 'finance', 'Hanya Draft, dengan alasan.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN (VALUES
  ('SALES_INVOICE_VIEW', 'SALES_CREDIT_NOTE_VIEW'),
  ('SALES_INVOICE_CREATE', 'SALES_CREDIT_NOTE_CREATE'),
  ('SALES_INVOICE_EDIT', 'SALES_CREDIT_NOTE_EDIT'),
  ('SALES_INVOICE_POST', 'SALES_CREDIT_NOTE_POST'),
  ('SALES_INVOICE_CANCEL', 'SALES_CREDIT_NOTE_CANCEL')
) AS g("held", "granted") ON g."held" = p."permission_code"
JOIN "sys_permission" m ON m."permission_code" = g."granted"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
