-- P299: Transfer Kas & Bank replaces Penukaran Valas (Cash-Bank-Transfer-Plan.md).
-- Renamed in place, so ids, journals, Cash Bank Book entries and the audit
-- trail keep naming it; every penukaran becomes a one-line transfer and keeps
-- its PVL/... number and its posted figures.

ALTER TYPE "CashExchangeStatus" RENAME TO "CashTransferStatus";
CREATE TYPE "CashTransferPurpose" AS ENUM ('Transfer', 'Pencairan', 'PembelianValas');

ALTER TABLE "fin_cash_exchange" RENAME TO "fin_cash_bank_transfer";
ALTER SEQUENCE "fin_cash_exchange_id_seq" RENAME TO "fin_cash_bank_transfer_id_seq";
ALTER TABLE "fin_cash_bank_transfer" RENAME CONSTRAINT "fin_cash_exchange_pkey" TO "fin_cash_bank_transfer_pkey";
ALTER TABLE "fin_cash_bank_transfer" RENAME COLUMN "exchange_no" TO "transfer_no";
ALTER TABLE "fin_cash_bank_transfer" RENAME COLUMN "exchange_date" TO "transfer_date";
ALTER INDEX "fin_cash_exchange_exchange_no_key" RENAME TO "fin_cash_bank_transfer_transfer_no_key";
ALTER INDEX "fin_cash_exchange_status_exchange_date_idx" RENAME TO "fin_cash_bank_transfer_status_transfer_date_idx";
ALTER TABLE "fin_cash_bank_transfer" RENAME CONSTRAINT "fin_cash_exchange_from_cash_bank_id_fkey" TO "fin_cash_bank_transfer_from_cash_bank_id_fkey";
ALTER TABLE "fin_cash_bank_transfer" RENAME CONSTRAINT "fin_cash_exchange_journal_id_fkey" TO "fin_cash_bank_transfer_journal_id_fkey";
ALTER TABLE "fin_cash_bank_transfer" DROP CONSTRAINT "fin_cash_exchange_two_resources";
ALTER TABLE "fin_cash_bank_transfer" DROP CONSTRAINT "fin_cash_exchange_amounts_positive";

ALTER TABLE "fin_cash_bank_transfer"
  ADD COLUMN "purpose" "CashTransferPurpose",
  ADD COLUMN "currency_id" INTEGER,
  ADD COLUMN "transfer_amount" DECIMAL(18,2);

CREATE TABLE "fin_cash_bank_transfer_line" (
    "id" SERIAL NOT NULL,
    "transfer_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "to_cash_bank_id" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL,
    "out_amount" DECIMAL(18,2) NOT NULL,
    "in_amount" DECIMAL(18,2) NOT NULL,
    "out_base" DECIMAL(18,2),
    "in_base" DECIMAL(18,2),
    "fx_difference" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fin_cash_bank_transfer_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fin_cash_bank_transfer_line_transfer_id_line_no_key" ON "fin_cash_bank_transfer_line"("transfer_id", "line_no");
CREATE UNIQUE INDEX "fin_cash_bank_transfer_line_transfer_id_to_cash_bank_id_key" ON "fin_cash_bank_transfer_line"("transfer_id", "to_cash_bank_id");
CREATE INDEX "fin_cash_bank_transfer_line_to_cash_bank_id_idx" ON "fin_cash_bank_transfer_line"("to_cash_bank_id");
ALTER TABLE "fin_cash_bank_transfer_line" ADD CONSTRAINT "fin_cash_bank_transfer_line_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "fin_cash_bank_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fin_cash_bank_transfer_line" ADD CONSTRAINT "fin_cash_bank_transfer_line_to_cash_bank_id_fkey" FOREIGN KEY ("to_cash_bank_id") REFERENCES "m_cash_bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each penukaran becomes line 1. Its amount is the foreign side; the rate is
-- what the two typed amounts implied, kept to six decimals for reading only —
-- out / in amounts and bases stay exactly as posted.
INSERT INTO "fin_cash_bank_transfer_line"
  ("transfer_id", "line_no", "to_cash_bank_id", "amount", "exchange_rate", "out_amount", "in_amount", "out_base", "in_base", "fx_difference")
SELECT t."id", 1, t."to_cash_bank_id",
       CASE WHEN fc."currency_label" = 'IDR' THEN t."to_amount" ELSE t."from_amount" END,
       ROUND(CASE WHEN fc."currency_label" = 'IDR' THEN t."from_amount" / t."to_amount" ELSE t."to_amount" / t."from_amount" END, 6),
       t."from_amount", t."to_amount", t."from_base", t."to_base", t."fx_difference"
FROM "fin_cash_bank_transfer" t
JOIN "m_cash_bank" f ON f."id" = t."from_cash_bank_id"
JOIN "ref_currency" fc ON fc."id" = f."currency_id";

UPDATE "fin_cash_bank_transfer" t
SET "purpose" = CASE WHEN fc."currency_label" = 'IDR' THEN 'PembelianValas'::"CashTransferPurpose" ELSE 'Pencairan'::"CashTransferPurpose" END,
    "currency_id" = CASE WHEN fc."currency_label" = 'IDR' THEN d."currency_id" ELSE f."currency_id" END,
    "transfer_amount" = CASE WHEN fc."currency_label" = 'IDR' THEN t."to_amount" ELSE t."from_amount" END
FROM "m_cash_bank" f, "ref_currency" fc, "m_cash_bank" d
WHERE f."id" = t."from_cash_bank_id" AND fc."id" = f."currency_id" AND d."id" = t."to_cash_bank_id";

ALTER TABLE "fin_cash_bank_transfer"
  ALTER COLUMN "purpose" SET NOT NULL,
  ALTER COLUMN "currency_id" SET NOT NULL,
  ALTER COLUMN "transfer_amount" SET NOT NULL,
  DROP CONSTRAINT "fin_cash_exchange_to_cash_bank_id_fkey",
  DROP COLUMN "to_cash_bank_id",
  DROP COLUMN "to_amount",
  DROP COLUMN "to_base";
ALTER TABLE "fin_cash_bank_transfer" ADD CONSTRAINT "fin_cash_bank_transfer_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "ref_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fin_cash_bank_transfer" ADD CONSTRAINT "fin_cash_bank_transfer_amounts_positive" CHECK ("transfer_amount" > 0 AND "from_amount" > 0);
ALTER TABLE "fin_cash_bank_transfer_line" ADD CONSTRAINT "fin_cash_bank_transfer_line_positive" CHECK ("amount" > 0 AND "exchange_rate" > 0 AND "out_amount" > 0 AND "in_amount" > 0);

-- Its document type, audit trail and permissions follow the rename; role grants stay.
UPDATE "sys_doc_type" SET "doc_table" = 'fin_cash_bank_transfer', "doc_label" = 'Transfer Kas & Bank', "doc_name" = 'Transfer Kas & Bank'
WHERE "doc_table" = 'fin_cash_exchange';
UPDATE "audit_log" SET "entity_key" = 'fin_cash_bank_transfer' WHERE "entity_key" = 'fin_cash_exchange';
UPDATE "sys_permission" SET "permission_code" = 'CASH_TRANSFER_' || substr("permission_code", 15),
       "permission_name" = replace("permission_name", 'Penukaran Valas', 'Transfer Kas & Bank'), "updated_at" = now()
WHERE "permission_code" LIKE 'CASH\_EXCHANGE\_%';
