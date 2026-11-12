-- Multi-Currency-Plan stage 1: the Kurs master and each partner's default
-- currency. Nothing reads either yet; the documents learn them in stage 3.

CREATE TYPE "ExchangeRateType" AS ENUM ('Transaction');

CREATE TABLE "ref_exchange_rate" (
    "id" SERIAL NOT NULL,
    "rate_code" TEXT NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "rate_type" "ExchangeRateType" NOT NULL DEFAULT 'Transaction',
    "rate_date" DATE NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ref_exchange_rate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ref_exchange_rate_rate_positive" CHECK ("rate" > 0)
);

CREATE UNIQUE INDEX "ref_exchange_rate_rate_code_key" ON "ref_exchange_rate"("rate_code");
CREATE INDEX "ref_exchange_rate_currency_id_rate_type_rate_date_idx" ON "ref_exchange_rate"("currency_id", "rate_type", "rate_date");
-- One rate a document can be offered per currency, type and day.
CREATE UNIQUE INDEX "ref_exchange_rate_one_active" ON "ref_exchange_rate"("currency_id", "rate_type", "rate_date") WHERE "status" = 'Active';

ALTER TABLE "ref_exchange_rate" ADD CONSTRAINT "ref_exchange_rate_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "m_partner" ADD COLUMN "sales_currency_id" INTEGER, ADD COLUMN "purchase_currency_id" INTEGER;
ALTER TABLE "m_partner" ADD CONSTRAINT "m_partner_sales_currency_id_fkey" FOREIGN KEY ("sales_currency_id") REFERENCES "ref_currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "m_partner" ADD CONSTRAINT "m_partner_purchase_currency_id_fkey" FOREIGN KEY ("purchase_currency_id") REFERENCES "ref_currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Its own menu and permissions, given to every role that may do the same to a
-- Currency.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('EXCHANGE_RATE_VIEW', 'Lihat Kurs', 'master', now()),
  ('EXCHANGE_RATE_CREATE', 'Tambah Kurs', 'master', now()),
  ('EXCHANGE_RATE_EDIT', 'Ubah Kurs', 'master', now()),
  ('EXCHANGE_RATE_ACTIVATE', 'Aktifkan Kurs', 'master', now()),
  ('EXCHANGE_RATE_DEACTIVATE', 'Nonaktifkan Kurs', 'master', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN "sys_permission" m ON m."permission_code" = CASE p."permission_code"
  WHEN 'CURRENCY_VIEW' THEN 'EXCHANGE_RATE_VIEW'
  WHEN 'CURRENCY_CREATE' THEN 'EXCHANGE_RATE_CREATE'
  WHEN 'CURRENCY_EDIT' THEN 'EXCHANGE_RATE_EDIT'
  WHEN 'CURRENCY_ACTIVATE' THEN 'EXCHANGE_RATE_ACTIVATE'
  WHEN 'CURRENCY_DEACTIVATE' THEN 'EXCHANGE_RATE_DEACTIVATE'
END
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
