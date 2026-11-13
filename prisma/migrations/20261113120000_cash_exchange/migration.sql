-- Multi-Currency-Plan stage 2a: Penukaran Valas, rupiah to a foreign Kas & Bank
-- or back (MC11a). Its document type is seeded by db:seed.

-- CreateEnum
CREATE TYPE "CashExchangeStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');

-- CreateTable
CREATE TABLE "fin_cash_exchange" (
    "id" SERIAL NOT NULL,
    "exchange_no" TEXT NOT NULL,
    "exchange_date" DATE NOT NULL,
    "status" "CashExchangeStatus" NOT NULL DEFAULT 'Draft',
    "from_cash_bank_id" INTEGER NOT NULL,
    "to_cash_bank_id" INTEGER NOT NULL,
    "from_amount" DECIMAL(18,2) NOT NULL,
    "to_amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "from_base" DECIMAL(18,2),
    "to_base" DECIMAL(18,2),
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "cancel_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_exchange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_exchange_exchange_no_key" ON "fin_cash_exchange"("exchange_no");

-- CreateIndex
CREATE INDEX "fin_cash_exchange_status_exchange_date_idx" ON "fin_cash_exchange"("status", "exchange_date");

-- AddForeignKey
ALTER TABLE "fin_cash_exchange" ADD CONSTRAINT "fin_cash_exchange_from_cash_bank_id_fkey" FOREIGN KEY ("from_cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_exchange" ADD CONSTRAINT "fin_cash_exchange_to_cash_bank_id_fkey" FOREIGN KEY ("to_cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_exchange" ADD CONSTRAINT "fin_cash_exchange_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "acc_journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Two different resources, each amount above nothing.
ALTER TABLE "fin_cash_exchange" ADD CONSTRAINT "fin_cash_exchange_two_resources" CHECK ("from_cash_bank_id" <> "to_cash_bank_id");
ALTER TABLE "fin_cash_exchange" ADD CONSTRAINT "fin_cash_exchange_amounts_positive" CHECK ("from_amount" > 0 AND "to_amount" > 0);

-- Its own permissions, given to every role that may do the same to a Pengeluaran.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('CASH_EXCHANGE_VIEW', 'Lihat Penukaran Valas', 'finance', now()),
  ('CASH_EXCHANGE_CREATE', 'Buat Penukaran Valas', 'finance', now()),
  ('CASH_EXCHANGE_EDIT', 'Ubah Penukaran Valas', 'finance', now()),
  ('CASH_EXCHANGE_POST', 'Posting Penukaran Valas', 'finance', now()),
  ('CASH_EXCHANGE_CANCEL', 'Batalkan Penukaran Valas', 'finance', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN "sys_permission" m ON m."permission_code" = CASE p."permission_code"
  WHEN 'CASH_PAYMENT_VIEW' THEN 'CASH_EXCHANGE_VIEW'
  WHEN 'CASH_PAYMENT_CREATE' THEN 'CASH_EXCHANGE_CREATE'
  WHEN 'CASH_PAYMENT_EDIT' THEN 'CASH_EXCHANGE_EDIT'
  WHEN 'CASH_PAYMENT_POST' THEN 'CASH_EXCHANGE_POST'
  WHEN 'CASH_PAYMENT_CANCEL' THEN 'CASH_EXCHANGE_CANCEL'
END
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
