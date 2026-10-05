-- P110: every book entry carries a ledger number, and the movements one
-- posting writes into a book share it, a line each. A document posts once, so
-- its source identifies the posting; existing entries are grouped by it.
-- Within a month, a group's number follows the id of its first entry, so the
-- line-1 rows — what the next number is read from — keep id order and number
-- order the same.

-- 1. Cash Bank Book: entry_no becomes ledger_no. A posting's first entry keeps
--    its CBL number; its other entries join it. An opening balance (no source)
--    keeps its own.
ALTER TABLE "cash_bank_ledger" RENAME COLUMN "entry_no" TO "ledger_no";
ALTER INDEX "cash_bank_ledger_entry_no_key" RENAME TO "cash_bank_ledger_ledger_no_line_no_key_tmp";
DROP INDEX "cash_bank_ledger_ledger_no_line_no_key_tmp";
ALTER TABLE "cash_bank_ledger" ADD COLUMN "line_no" INTEGER;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY COALESCE(source_doc_type_id, -id), COALESCE(source_doc_id, -id) ORDER BY id) AS rn,
         FIRST_VALUE(ledger_no) OVER (PARTITION BY COALESCE(source_doc_type_id, -id), COALESCE(source_doc_id, -id) ORDER BY id) AS first_no
  FROM "cash_bank_ledger"
)
UPDATE "cash_bank_ledger" c SET "line_no" = r.rn, "ledger_no" = r.first_no
FROM ranked r WHERE r.id = c.id;

ALTER TABLE "cash_bank_ledger" ALTER COLUMN "line_no" SET NOT NULL;
CREATE UNIQUE INDEX "cash_bank_ledger_ledger_no_line_no_key" ON "cash_bank_ledger"("ledger_no", "line_no");

-- 2. Buku Piutang: BP/YYYY/MM/NNNN per posting.
ALTER TABLE "fin_ar_ledger" ADD COLUMN "ledger_no" TEXT;
ALTER TABLE "fin_ar_ledger" ADD COLUMN "line_no" INTEGER;

WITH firsts AS (
  SELECT doc_type_id, doc_id, MIN(id) AS first_id FROM "fin_ar_ledger" GROUP BY doc_type_id, doc_id
), numbered AS (
  SELECT f.doc_type_id, f.doc_id,
         'BP/' || to_char(l.entry_date, 'YYYY/MM') || '/' ||
           lpad((ROW_NUMBER() OVER (PARTITION BY to_char(l.entry_date, 'YYYY/MM') ORDER BY f.first_id))::text, 4, '0') AS ledger_no
  FROM firsts f JOIN "fin_ar_ledger" l ON l.id = f.first_id
), lines AS (
  SELECT id, doc_type_id, doc_id, ROW_NUMBER() OVER (PARTITION BY doc_type_id, doc_id ORDER BY id) AS rn FROM "fin_ar_ledger"
)
UPDATE "fin_ar_ledger" e SET "ledger_no" = n.ledger_no, "line_no" = x.rn
FROM lines x JOIN numbered n ON n.doc_type_id = x.doc_type_id AND n.doc_id = x.doc_id
WHERE x.id = e.id;

ALTER TABLE "fin_ar_ledger" ALTER COLUMN "ledger_no" SET NOT NULL;
ALTER TABLE "fin_ar_ledger" ALTER COLUMN "line_no" SET NOT NULL;
CREATE UNIQUE INDEX "fin_ar_ledger_ledger_no_line_no_key" ON "fin_ar_ledger"("ledger_no", "line_no");

-- 3. Stock movement (the stand-in inventory): MS/YYYY/MM/NNNN per posting.
ALTER TABLE "tmp_stock_movement" ADD COLUMN "ledger_no" TEXT;
ALTER TABLE "tmp_stock_movement" ADD COLUMN "line_no" INTEGER;

WITH firsts AS (
  SELECT source_doc_type_id, source_doc_id, MIN(id) AS first_id FROM "tmp_stock_movement" GROUP BY source_doc_type_id, source_doc_id
), numbered AS (
  SELECT f.source_doc_type_id, f.source_doc_id,
         'MS/' || to_char(m.movement_date, 'YYYY/MM') || '/' ||
           lpad((ROW_NUMBER() OVER (PARTITION BY to_char(m.movement_date, 'YYYY/MM') ORDER BY f.first_id))::text, 4, '0') AS ledger_no
  FROM firsts f JOIN "tmp_stock_movement" m ON m.id = f.first_id
), lines AS (
  SELECT id, source_doc_type_id, source_doc_id, ROW_NUMBER() OVER (PARTITION BY source_doc_type_id, source_doc_id ORDER BY id) AS rn
  FROM "tmp_stock_movement"
)
UPDATE "tmp_stock_movement" t SET "ledger_no" = n.ledger_no, "line_no" = x.rn
FROM lines x JOIN numbered n ON n.source_doc_type_id = x.source_doc_type_id AND n.source_doc_id = x.source_doc_id
WHERE x.id = t.id;

ALTER TABLE "tmp_stock_movement" ALTER COLUMN "ledger_no" SET NOT NULL;
ALTER TABLE "tmp_stock_movement" ALTER COLUMN "line_no" SET NOT NULL;
CREATE UNIQUE INDEX "tmp_stock_movement_ledger_no_line_no_key" ON "tmp_stock_movement"("ledger_no", "line_no");
