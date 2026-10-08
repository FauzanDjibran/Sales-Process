-- P137 (Perizinan-Concept.md Z20): an AR item and a faktur pajak are scoped by
-- the weak pair (scope_doc_type_id, scope_doc_id) — a Customer Order or a
-- Pengajuan Perizinan — instead of customer_order_id. Existing rows keep
-- their Customer Order, now named through its document type.


-- fin_ar_item
ALTER TABLE "fin_ar_item" ADD COLUMN "scope_doc_type_id" INTEGER, ADD COLUMN "scope_doc_id" INTEGER;
UPDATE "fin_ar_item"
   SET "scope_doc_type_id" = (SELECT "id" FROM "sys_doc_type" WHERE "doc_table" = 'sal_customer_order'),
       "scope_doc_id" = "customer_order_id"
 WHERE "customer_order_id" IS NOT NULL;
DROP INDEX "fin_ar_item_customer_order_id_idx";
ALTER TABLE "fin_ar_item" DROP COLUMN "customer_order_id";
CREATE INDEX "fin_ar_item_scope_doc_type_id_scope_doc_id_idx" ON "fin_ar_item"("scope_doc_type_id", "scope_doc_id");
ALTER TABLE "fin_ar_item" ADD CONSTRAINT "fin_ar_item_scope_doc_type_id_fkey" FOREIGN KEY ("scope_doc_type_id") REFERENCES "sys_doc_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- tax_faktur
ALTER TABLE "tax_faktur" ADD COLUMN "scope_doc_type_id" INTEGER, ADD COLUMN "scope_doc_id" INTEGER;
UPDATE "tax_faktur"
   SET "scope_doc_type_id" = (SELECT "id" FROM "sys_doc_type" WHERE "doc_table" = 'sal_customer_order'),
       "scope_doc_id" = "customer_order_id";
ALTER TABLE "tax_faktur" ALTER COLUMN "scope_doc_type_id" SET NOT NULL, ALTER COLUMN "scope_doc_id" SET NOT NULL;
ALTER TABLE "tax_faktur" DROP COLUMN "customer_order_id";
