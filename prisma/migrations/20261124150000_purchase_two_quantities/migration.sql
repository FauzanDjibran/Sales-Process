-- Two quantities side by side (P320): what is bought and billed in the PO's
-- unit, and what it is in base units. Old rows are their own quantity times
-- the factor they already carry.

ALTER TABLE "pur_order_line"
  ADD COLUMN "base_qty" DECIMAL(18,4),
  ADD COLUMN "received_base_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ALTER COLUMN "received_qty" SET DATA TYPE DECIMAL(18,6);
UPDATE "pur_order_line" SET "base_qty" = ROUND("qty" * "uom_factor", 4);
ALTER TABLE "pur_order_line" ALTER COLUMN "base_qty" SET NOT NULL;

ALTER TABLE "log_receipt_note_line" ALTER COLUMN "qty" SET DATA TYPE DECIMAL(18,6);
ALTER TABLE "fin_ap_invoice_line" ALTER COLUMN "qty" SET DATA TYPE DECIMAL(18,6);

UPDATE "pur_order_line" l SET "received_base_qty" = r.q
FROM (SELECT rl.source_doc_line_id AS id, SUM(rl.base_qty) AS q
      FROM "log_receipt_note_line" rl JOIN "log_receipt_note" n ON n.id = rl.receipt_note_id
      WHERE n.status = 'Posted' AND n.purpose = 'purchase_receipt' GROUP BY rl.source_doc_line_id) r
WHERE r.id = l.id;

-- A lot is counted in base units, as a Delivery Note's is (P268); a Draft's were
-- still only in the line's unit.
UPDATE "log_receipt_note_tracking" t SET "base_qty" = ROUND(t."qty" * l."uom_factor", 4)
FROM "log_receipt_note_line" l JOIN "log_receipt_note" n ON n.id = l.receipt_note_id
WHERE l.id = t.line_id AND n.status <> 'Posted';
ALTER TABLE "log_receipt_note_tracking" ALTER COLUMN "base_qty" DROP DEFAULT, DROP COLUMN "qty";
