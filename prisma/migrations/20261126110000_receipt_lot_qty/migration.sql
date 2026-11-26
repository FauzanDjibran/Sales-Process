-- P338: a Receipt Note lot is typed in the line's unit again. Existing rows get
-- their share of the line's qty by base quantity, cumulative, so the lots of a
-- line that holds all of it add up to the line exactly. A return line is in base
-- units, so the same formula gives qty = base_qty.
ALTER TABLE "log_receipt_note_tracking" ADD COLUMN "qty" DECIMAL(18,6);

WITH kum AS (
  SELECT t.id, t.base_qty, l.qty AS line_qty, l.base_qty AS line_base,
         SUM(t.base_qty) OVER (PARTITION BY t.line_id ORDER BY t.tracking_seq) AS k
  FROM "log_receipt_note_tracking" t
  JOIN "log_receipt_note_line" l ON l.id = t.line_id
)
UPDATE "log_receipt_note_tracking" t
SET "qty" = ROUND(kum.line_qty * kum.k / kum.line_base, 6) - ROUND(kum.line_qty * (kum.k - kum.base_qty) / kum.line_base, 6)
FROM kum WHERE kum.id = t.id;

ALTER TABLE "log_receipt_note_tracking" ALTER COLUMN "qty" SET NOT NULL;
