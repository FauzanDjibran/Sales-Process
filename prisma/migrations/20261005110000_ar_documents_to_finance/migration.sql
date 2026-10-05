-- P107: the Sales module holds only orders. The advance bill and the Invoice
-- Penjualan bill or settle money, so they move to Finance as fin_ar_advance
-- and fin_ar_invoice(_line, _advance_deduction). Renamed in place: ids, and
-- every journal, receipt line, AR item, tax document and audit entry naming
-- them, stay valid. The Customer Order is now another module's document to
-- them, named by id without a foreign key (§3.1).

-- 1. Foreign keys into the Customer Order go.
ALTER TABLE "sal_advance" DROP CONSTRAINT "sal_advance_customer_order_id_fkey";
ALTER TABLE "sal_invoice" DROP CONSTRAINT "sal_invoice_customer_order_id_fkey";
ALTER TABLE "sal_invoice_line" DROP CONSTRAINT "sal_invoice_line_customer_order_line_id_fkey";

-- 2. Tables, keys, indexes and constraints take the fin_ar_ names.
ALTER TABLE "sal_advance" RENAME TO "fin_ar_advance";
ALTER TABLE "sal_invoice" RENAME TO "fin_ar_invoice";
ALTER TABLE "sal_invoice_line" RENAME TO "fin_ar_invoice_line";
ALTER TABLE "sal_invoice_advance_deduction" RENAME TO "fin_ar_invoice_advance_deduction";

ALTER TABLE "fin_ar_advance" RENAME CONSTRAINT "sal_advance_pkey" TO "fin_ar_advance_pkey";
ALTER TABLE "fin_ar_advance" RENAME CONSTRAINT "sal_advance_customer_id_fkey" TO "fin_ar_advance_customer_id_fkey";
ALTER TABLE "fin_ar_advance" RENAME CONSTRAINT "sal_advance_cash_bank_id_fkey" TO "fin_ar_advance_cash_bank_id_fkey";
ALTER INDEX "sal_advance_advance_no_key" RENAME TO "fin_ar_advance_advance_no_key";
ALTER INDEX "sal_advance_customer_id_idx" RENAME TO "fin_ar_advance_customer_id_idx";
ALTER INDEX "sal_advance_customer_order_id_idx" RENAME TO "fin_ar_advance_customer_order_id_idx";
ALTER INDEX "sal_advance_status_advance_date_idx" RENAME TO "fin_ar_advance_status_advance_date_idx";

ALTER TABLE "fin_ar_invoice" RENAME CONSTRAINT "sal_invoice_pkey" TO "fin_ar_invoice_pkey";
ALTER TABLE "fin_ar_invoice" RENAME CONSTRAINT "sal_invoice_customer_id_fkey" TO "fin_ar_invoice_customer_id_fkey";
ALTER TABLE "fin_ar_invoice" RENAME CONSTRAINT "sal_invoice_address_id_fkey" TO "fin_ar_invoice_address_id_fkey";
ALTER TABLE "fin_ar_invoice" RENAME CONSTRAINT "sal_invoice_cash_bank_id_fkey" TO "fin_ar_invoice_cash_bank_id_fkey";
ALTER INDEX "sal_invoice_invoice_no_key" RENAME TO "fin_ar_invoice_invoice_no_key";
ALTER INDEX "sal_invoice_customer_order_id_idx" RENAME TO "fin_ar_invoice_customer_order_id_idx";
ALTER INDEX "sal_invoice_status_invoice_date_idx" RENAME TO "fin_ar_invoice_status_invoice_date_idx";

ALTER TABLE "fin_ar_invoice_line" RENAME CONSTRAINT "sal_invoice_line_pkey" TO "fin_ar_invoice_line_pkey";
ALTER TABLE "fin_ar_invoice_line" RENAME CONSTRAINT "sal_invoice_line_invoice_id_fkey" TO "fin_ar_invoice_line_invoice_id_fkey";
ALTER TABLE "fin_ar_invoice_line" RENAME CONSTRAINT "sal_invoice_line_withholding_tax_id_fkey" TO "fin_ar_invoice_line_withholding_tax_id_fkey";
ALTER INDEX "sal_invoice_line_customer_order_line_id_idx" RENAME TO "fin_ar_invoice_line_customer_order_line_id_idx";
ALTER INDEX "sal_invoice_line_delivery_note_line_id_idx" RENAME TO "fin_ar_invoice_line_delivery_note_line_id_idx";
ALTER INDEX "sal_invoice_line_invoice_id_delivery_note_line_id_key" RENAME TO "fin_ar_invoice_line_invoice_id_delivery_note_line_id_key";
ALTER INDEX "sal_invoice_line_invoice_id_line_no_key" RENAME TO "fin_ar_invoice_line_invoice_id_line_no_key";

ALTER TABLE "fin_ar_invoice_advance_deduction" RENAME CONSTRAINT "sal_invoice_advance_deduction_pkey" TO "fin_ar_invoice_advance_deduction_pkey";
ALTER TABLE "fin_ar_invoice_advance_deduction" RENAME CONSTRAINT "sal_invoice_advance_deduction_invoice_id_fkey" TO "fin_ar_invoice_advance_deduction_invoice_id_fkey";
ALTER INDEX "sal_invoice_advance_deduction_ar_item_id_idx" RENAME TO "fin_ar_invoice_advance_deduction_ar_item_id_idx";
ALTER INDEX "sal_invoice_advance_deduction_invoice_id_ar_item_id_key" RENAME TO "fin_ar_invoice_advance_deduction_invoice_id_ar_item_id_key";

-- 3. The document types keep their rows (and ids); only their tables change.
UPDATE "sys_doc_type" SET "doc_table" = 'fin_ar_advance' WHERE "doc_table" = 'sal_advance';
UPDATE "sys_doc_type" SET "doc_table" = 'fin_ar_invoice' WHERE "doc_table" = 'sal_invoice';
UPDATE "audit_log" SET "entity_key" = 'fin_ar_advance' WHERE "entity_key" = 'sal_advance';
UPDATE "audit_log" SET "entity_key" = 'fin_ar_invoice' WHERE "entity_key" = 'sal_invoice';

-- 4. The Invoice's permissions belong to the Finance menu now; whoever could
--    see Invoices keeps reaching that menu.
UPDATE "sys_permission" SET "module" = 'finance' WHERE "permission_code" LIKE 'SALES_INVOICE_%';
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'SALES_INVOICE_VIEW'
CROSS JOIN "sys_permission" m
WHERE m."permission_code" = 'MENU_FINANCE_ACCESS'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
