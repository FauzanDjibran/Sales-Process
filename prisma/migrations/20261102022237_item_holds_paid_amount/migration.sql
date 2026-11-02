-- P214: the AR / AP item holds what its source document has been paid; the
-- document keeps its value only. One item per document, identified by it.

ALTER TABLE "fin_ar_item" ADD COLUMN "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_ap_item" ADD COLUMN "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- A document paid before an item existed for it cannot be moved: refuse.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT 'fin_ar_advance' t, id, paid_amount FROM fin_ar_advance
      UNION ALL SELECT 'fin_ar_invoice', id, paid_amount FROM fin_ar_invoice
      UNION ALL SELECT 'fin_ar_permit_advance', id, paid_amount FROM fin_ar_permit_advance
      UNION ALL SELECT 'fin_ar_permit_invoice', id, paid_amount FROM fin_ar_permit_invoice
    ) d
    JOIN sys_doc_type dt ON dt.doc_table = d.t
    WHERE d.paid_amount > 0
      AND NOT EXISTS (SELECT 1 FROM fin_ar_item i WHERE i.source_doc_type_id = dt.id AND i.source_doc_id = d.id)
  ) OR EXISTS (
    SELECT 1 FROM (
      SELECT 'fin_ap_advance' t, id, paid_amount FROM fin_ap_advance
      UNION ALL SELECT 'fin_ap_invoice', id, paid_amount FROM fin_ap_invoice
    ) d
    JOIN sys_doc_type dt ON dt.doc_table = d.t
    WHERE d.paid_amount > 0
      AND NOT EXISTS (SELECT 1 FROM fin_ap_item i WHERE i.source_doc_type_id = dt.id AND i.source_doc_id = d.id)
  ) THEN
    RAISE EXCEPTION 'A paid document has no AR / AP item to hold its paid amount';
  END IF;
END $$;

UPDATE fin_ar_item i SET paid_amount = d.paid_amount
FROM (
  SELECT 'fin_ar_advance' t, id, paid_amount FROM fin_ar_advance
  UNION ALL SELECT 'fin_ar_invoice', id, paid_amount FROM fin_ar_invoice
  UNION ALL SELECT 'fin_ar_permit_advance', id, paid_amount FROM fin_ar_permit_advance
  UNION ALL SELECT 'fin_ar_permit_invoice', id, paid_amount FROM fin_ar_permit_invoice
) d
JOIN sys_doc_type dt ON dt.doc_table = d.t
WHERE i.source_doc_type_id = dt.id AND i.source_doc_id = d.id;

UPDATE fin_ap_item i SET paid_amount = d.paid_amount
FROM (
  SELECT 'fin_ap_advance' t, id, paid_amount FROM fin_ap_advance
  UNION ALL SELECT 'fin_ap_invoice', id, paid_amount FROM fin_ap_invoice
) d
JOIN sys_doc_type dt ON dt.doc_table = d.t
WHERE i.source_doc_type_id = dt.id AND i.source_doc_id = d.id;

ALTER TABLE "fin_ar_item" ADD CONSTRAINT "fin_ar_item_paid_not_negative" CHECK ("paid_amount" >= 0);
ALTER TABLE "fin_ap_item" ADD CONSTRAINT "fin_ap_item_paid_not_negative" CHECK ("paid_amount" >= 0);

-- One item per document, whatever its type: the document's id is the item's identity.
DROP INDEX "fin_ar_item_one_advance_per_source";
DROP INDEX "fin_ap_item_one_advance_per_source";
DROP INDEX "fin_ar_item_source_doc_type_id_source_doc_id_idx";
DROP INDEX "fin_ap_item_source_doc_type_id_source_doc_id_idx";
CREATE UNIQUE INDEX "fin_ar_item_source_doc_type_id_source_doc_id_key" ON "fin_ar_item"("source_doc_type_id", "source_doc_id");
CREATE UNIQUE INDEX "fin_ap_item_source_doc_type_id_source_doc_id_key" ON "fin_ap_item"("source_doc_type_id", "source_doc_id");

-- The documents keep their value only (their paid CHECKs go with the columns).
ALTER TABLE "fin_ar_advance" DROP COLUMN "paid_amount";
ALTER TABLE "fin_ar_invoice" DROP COLUMN "paid_amount";
ALTER TABLE "fin_ar_permit_advance" DROP COLUMN "paid_amount";
ALTER TABLE "fin_ar_permit_invoice" DROP COLUMN "paid_amount";
ALTER TABLE "fin_ap_advance" DROP COLUMN "paid_amount";
ALTER TABLE "fin_ap_invoice" DROP COLUMN "paid_amount";
