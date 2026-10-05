-- P106: the Delivery Note becomes a standalone document (log_), named by a
-- purpose and a weak source pair, its lines carrying their own item, unit and
-- factor. Renamed in place, so ids — and every journal, stock movement, audit
-- entry and Invoice line naming them — stay valid.

-- 1. Foreign keys into another module's documents go: the source is now weak.
ALTER TABLE "sal_invoice_line" DROP CONSTRAINT "sal_invoice_line_delivery_note_line_id_fkey";
ALTER TABLE "sal_delivery_note" DROP CONSTRAINT "sal_delivery_note_delivery_order_id_fkey";
ALTER TABLE "sal_delivery_note" DROP CONSTRAINT "sal_delivery_note_customer_order_id_fkey";
ALTER TABLE "sal_delivery_note_line" DROP CONSTRAINT "sal_delivery_note_line_delivery_order_line_id_fkey";

-- 2. Tables, keys, indexes and constraints take the log_ names.
ALTER TABLE "sal_delivery_note" RENAME TO "log_delivery_note";
ALTER TABLE "sal_delivery_note_line" RENAME TO "log_delivery_note_line";
ALTER TABLE "sal_delivery_note_pick" RENAME TO "log_delivery_note_lot";

ALTER TABLE "log_delivery_note" RENAME CONSTRAINT "sal_delivery_note_pkey" TO "log_delivery_note_pkey";
ALTER TABLE "log_delivery_note_line" RENAME CONSTRAINT "sal_delivery_note_line_pkey" TO "log_delivery_note_line_pkey";
ALTER TABLE "log_delivery_note_lot" RENAME CONSTRAINT "sal_delivery_note_pick_pkey" TO "log_delivery_note_lot_pkey";

ALTER INDEX "sal_delivery_note_dn_no_key" RENAME TO "log_delivery_note_dn_no_key";
ALTER INDEX "sal_delivery_note_status_dn_date_idx" RENAME TO "log_delivery_note_status_dn_date_idx";
ALTER INDEX "sal_delivery_note_line_delivery_note_id_line_no_key" RENAME TO "log_delivery_note_line_delivery_note_id_line_no_key";
ALTER INDEX "sal_delivery_note_pick_lot_id_idx" RENAME TO "log_delivery_note_lot_lot_id_idx";
ALTER INDEX "sal_delivery_note_pick_delivery_note_line_id_pick_no_key" RENAME TO "log_delivery_note_lot_delivery_note_line_id_pick_no_key";
ALTER INDEX "sal_delivery_note_pick_delivery_note_line_id_lot_id_key" RENAME TO "log_delivery_note_lot_delivery_note_line_id_lot_id_key";
DROP INDEX "sal_delivery_note_delivery_order_id_idx";
DROP INDEX "sal_delivery_note_customer_order_id_idx";
DROP INDEX "sal_delivery_note_line_delivery_order_line_id_idx";
DROP INDEX "sal_delivery_note_line_delivery_note_id_delivery_order_line_key";

ALTER TABLE "log_delivery_note" RENAME CONSTRAINT "sal_delivery_note_customer_id_fkey" TO "log_delivery_note_partner_id_fkey";
ALTER TABLE "log_delivery_note" RENAME CONSTRAINT "sal_delivery_note_warehouse_id_fkey" TO "log_delivery_note_warehouse_id_fkey";
ALTER TABLE "log_delivery_note" RENAME CONSTRAINT "sal_delivery_note_address_id_fkey" TO "log_delivery_note_address_id_fkey";
ALTER TABLE "log_delivery_note_line" RENAME CONSTRAINT "sal_delivery_note_line_delivery_note_id_fkey" TO "log_delivery_note_line_delivery_note_id_fkey";
ALTER TABLE "log_delivery_note_lot" RENAME CONSTRAINT "sal_delivery_note_pick_delivery_note_line_id_fkey" TO "log_delivery_note_lot_delivery_note_line_id_fkey";

-- 3. The document type keeps its row (and id); only its table changes.
UPDATE "sys_doc_type" SET "doc_table" = 'log_delivery_note' WHERE "doc_table" = 'sal_delivery_note';
UPDATE "audit_log" SET "entity_key" = 'log_delivery_note' WHERE "entity_key" = 'sal_delivery_note';

-- 4. Header: purpose and the weak source pair; the partner is the customer.
ALTER TABLE "log_delivery_note" RENAME COLUMN "customer_id" TO "partner_id";
ALTER TABLE "log_delivery_note" RENAME COLUMN "delivery_order_id" TO "source_doc_id";
ALTER TABLE "log_delivery_note" ADD COLUMN "purpose" TEXT;
ALTER TABLE "log_delivery_note" ADD COLUMN "source_doc_type_id" INTEGER;
ALTER TABLE "log_delivery_note" ADD COLUMN "source_no" TEXT;

UPDATE "log_delivery_note" n SET
  "purpose" = 'sales_delivery',
  "source_doc_type_id" = (SELECT "id" FROM "sys_doc_type" WHERE "doc_table" = 'sal_delivery_order'),
  "source_no" = (SELECT d."do_no" FROM "sal_delivery_order" d WHERE d."id" = n."source_doc_id");

ALTER TABLE "log_delivery_note" ALTER COLUMN "purpose" SET NOT NULL;
ALTER TABLE "log_delivery_note" ALTER COLUMN "source_doc_type_id" SET NOT NULL;
ALTER TABLE "log_delivery_note" ALTER COLUMN "source_no" SET NOT NULL;
ALTER TABLE "log_delivery_note" DROP COLUMN "customer_order_id";

-- 5. Line: the weak source line, and its own item, unit and factor — copied
--    from the Customer Order line the Delivery Order line comes from.
ALTER TABLE "log_delivery_note_line" RENAME COLUMN "delivery_order_line_id" TO "source_doc_line_id";
ALTER TABLE "log_delivery_note_line" ADD COLUMN "item_id" INTEGER;
ALTER TABLE "log_delivery_note_line" ADD COLUMN "uom_id" INTEGER;
ALTER TABLE "log_delivery_note_line" ADD COLUMN "uom_factor" DECIMAL(18,4) NOT NULL DEFAULT 1;

UPDATE "log_delivery_note_line" l SET
  "item_id" = col."item_id",
  "uom_id" = col."uom_id",
  "uom_factor" = col."uom_factor",
  "base_qty" = ROUND(l."qty" * col."uom_factor", 4)
FROM "sal_delivery_order_line" dol
JOIN "sal_order_line" sol ON sol."id" = dol."sales_order_line_id"
JOIN "sal_customer_order_line" col ON col."id" = sol."customer_order_line_id"
WHERE dol."id" = l."source_doc_line_id";

ALTER TABLE "log_delivery_note_line" ALTER COLUMN "item_id" SET NOT NULL;
ALTER TABLE "log_delivery_note_line" ALTER COLUMN "uom_id" SET NOT NULL;

-- 6. New indexes and foreign keys (master data and the kernel only).
CREATE INDEX "log_delivery_note_source_doc_type_id_source_doc_id_idx" ON "log_delivery_note"("source_doc_type_id", "source_doc_id");
CREATE INDEX "log_delivery_note_purpose_status_idx" ON "log_delivery_note"("purpose", "status");
CREATE INDEX "log_delivery_note_line_source_doc_line_id_idx" ON "log_delivery_note_line"("source_doc_line_id");
CREATE INDEX "log_delivery_note_line_item_id_idx" ON "log_delivery_note_line"("item_id");
CREATE UNIQUE INDEX "log_delivery_note_line_delivery_note_id_source_doc_line_id_key" ON "log_delivery_note_line"("delivery_note_id", "source_doc_line_id");

ALTER TABLE "log_delivery_note" ADD CONSTRAINT "log_delivery_note_source_doc_type_id_fkey" FOREIGN KEY ("source_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "log_delivery_note_line" ADD CONSTRAINT "log_delivery_note_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "log_delivery_note_line" ADD CONSTRAINT "log_delivery_note_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Logistik is its own menu; whoever saw Delivery Notes keeps seeing them.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at")
VALUES ('MENU_LOGISTICS_ACCESS', 'Akses menu Logistik', 'logistics', now())
ON CONFLICT ("permission_code") DO NOTHING;
UPDATE "sys_permission" SET "module" = 'logistics' WHERE "permission_code" LIKE 'DELIVERY_NOTE_%';
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'DELIVERY_NOTE_VIEW'
CROSS JOIN "sys_permission" m
WHERE m."permission_code" = 'MENU_LOGISTICS_ACCESS'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
