-- An advance bill keeps what posted receipts / payments settled of it (P132),
-- so a receipt reads the bill instead of summing the receipts before it.

-- AlterTable
ALTER TABLE "fin_ap_advance" ADD COLUMN     "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fin_ar_advance" ADD COLUMN     "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Backfill: what the posted lines naming each bill settled.
UPDATE "fin_ar_advance" a SET "paid_amount" = s.paid
FROM (
  SELECT l.doc_id, SUM(l.settled_amount) AS paid
  FROM "fin_cash_bank_tx_line" l
  JOIN "fin_cash_bank_tx" t ON t.id = l.tx_id AND t.status = 'Posted'
  JOIN "sys_doc_type" d ON d.id = l.doc_type_id AND d.doc_table = 'fin_ar_advance'
  GROUP BY l.doc_id
) s
WHERE a.id = s.doc_id;

UPDATE "fin_ap_advance" a SET "paid_amount" = s.paid
FROM (
  SELECT l.doc_id, SUM(l.settled_amount) AS paid
  FROM "fin_cash_bank_tx_line" l
  JOIN "fin_cash_bank_tx" t ON t.id = l.tx_id AND t.status = 'Posted'
  JOIN "sys_doc_type" d ON d.id = l.doc_type_id AND d.doc_table = 'fin_ap_advance'
  GROUP BY l.doc_id
) s
WHERE a.id = s.doc_id;

-- Never negative, never beyond the bill.
ALTER TABLE "fin_ar_advance" ADD CONSTRAINT "fin_ar_advance_paid_within_total" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
ALTER TABLE "fin_ap_advance" ADD CONSTRAINT "fin_ap_advance_paid_within_total" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
