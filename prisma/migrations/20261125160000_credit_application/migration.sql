-- Penerapan Kredit (P332, Sales-Return-Plan.md §12 step 9): customer credit taken off open Invoices.

-- CreateTable
CREATE TABLE "fin_ar_credit_application" (
    "id" SERIAL NOT NULL,
    "application_no" TEXT NOT NULL,
    "application_date" DATE NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'Draft',
    "customer_id" INTEGER NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_ar_credit_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_ar_credit_application_line" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "credit_note_id" INTEGER NOT NULL,
    "return_item_id" INTEGER NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "invoice_item_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "return_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoice_base_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fin_ar_credit_application_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_credit_application_application_no_key" ON "fin_ar_credit_application"("application_no");

-- CreateIndex
CREATE INDEX "fin_ar_credit_application_status_application_date_idx" ON "fin_ar_credit_application"("status", "application_date");

-- CreateIndex
CREATE INDEX "fin_ar_credit_application_line_credit_note_id_idx" ON "fin_ar_credit_application_line"("credit_note_id");

-- CreateIndex
CREATE INDEX "fin_ar_credit_application_line_invoice_id_idx" ON "fin_ar_credit_application_line"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_credit_application_line_application_id_line_no_key" ON "fin_ar_credit_application_line"("application_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "fin_ar_credit_application_line_application_id_credit_note_i_key" ON "fin_ar_credit_application_line"("application_id", "credit_note_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "fin_ar_credit_application" ADD CONSTRAINT "fin_ar_credit_application_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_credit_application" ADD CONSTRAINT "fin_ar_credit_application_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_ar_credit_application_line" ADD CONSTRAINT "fin_ar_credit_application_line_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "fin_ar_credit_application"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddCheck
ALTER TABLE "fin_ar_credit_application_line" ADD CONSTRAINT "fin_ar_credit_application_line_amount_positive" CHECK ("amount" > 0);

-- Its menu and permissions, given to every role that may do the same to a Credit Note.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('SALES_CREDIT_APPLICATION_VIEW', 'Lihat Penerapan Kredit', 'finance', 'Termasuk yang masih Draft dan yang dibatalkan.', now()),
  ('SALES_CREDIT_APPLICATION_CREATE', 'Buat Penerapan Kredit', 'finance', 'Dari kredit customer yang masih terbuka.', now()),
  ('SALES_CREDIT_APPLICATION_EDIT', 'Ubah Penerapan Kredit', 'finance', 'Hanya selama masih Draft.', now()),
  ('SALES_CREDIT_APPLICATION_POST', 'Posting Penerapan Kredit', 'finance', 'Memotongkan kredit customer ke Invoice Penjualan.', now()),
  ('SALES_CREDIT_APPLICATION_CANCEL', 'Batalkan Penerapan Kredit', 'finance', 'Hanya Draft, dengan alasan.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN "sys_permission" m ON m."permission_code" = replace(p."permission_code", 'SALES_CREDIT_NOTE_', 'SALES_CREDIT_APPLICATION_')
WHERE p."permission_code" LIKE 'SALES\_CREDIT\_NOTE\_%'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
