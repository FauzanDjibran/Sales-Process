-- The Sales Order becomes the Customer Order (Claude-ERP.md P78): the
-- commercial agreement advances and invoices are drawn from. Renamed in place,
-- so every order, line, advance and AR item keeps its rows and its links; the
-- name "Sales Order" is freed for the child document that releases a Customer
-- Order's quantity to PPIC.

ALTER TYPE "SalesOrderStatus" RENAME TO "CustomerOrderStatus";

-- ---- the order
ALTER TABLE "sal_order" RENAME TO "sal_customer_order";
ALTER SEQUENCE "sal_order_id_seq" RENAME TO "sal_customer_order_id_seq";
ALTER TABLE "sal_customer_order" RENAME CONSTRAINT "sal_order_pkey" TO "sal_customer_order_pkey";
ALTER TABLE "sal_customer_order" RENAME CONSTRAINT "sal_order_address_id_fkey" TO "sal_customer_order_address_id_fkey";
ALTER TABLE "sal_customer_order" RENAME CONSTRAINT "sal_order_copied_from_id_fkey" TO "sal_customer_order_copied_from_id_fkey";
ALTER TABLE "sal_customer_order" RENAME CONSTRAINT "sal_order_customer_id_fkey" TO "sal_customer_order_customer_id_fkey";
ALTER TABLE "sal_customer_order" RENAME CONSTRAINT "sal_order_term_id_fkey" TO "sal_customer_order_term_id_fkey";
ALTER INDEX "sal_order_order_no_key" RENAME TO "sal_customer_order_order_no_key";
ALTER INDEX "sal_order_customer_id_idx" RENAME TO "sal_customer_order_customer_id_idx";
ALTER INDEX "sal_order_status_order_date_idx" RENAME TO "sal_customer_order_status_order_date_idx";

-- ---- its lines
ALTER TABLE "sal_order_line" RENAME TO "sal_customer_order_line";
ALTER SEQUENCE "sal_order_line_id_seq" RENAME TO "sal_customer_order_line_id_seq";
ALTER TABLE "sal_customer_order_line" RENAME CONSTRAINT "sal_order_line_pkey" TO "sal_customer_order_line_pkey";
ALTER TABLE "sal_customer_order_line" RENAME CONSTRAINT "sal_order_line_item_id_fkey" TO "sal_customer_order_line_item_id_fkey";
ALTER TABLE "sal_customer_order_line" RENAME CONSTRAINT "sal_order_line_order_id_fkey" TO "sal_customer_order_line_order_id_fkey";
ALTER TABLE "sal_customer_order_line" RENAME CONSTRAINT "sal_order_line_uom_id_fkey" TO "sal_customer_order_line_uom_id_fkey";
ALTER TABLE "sal_customer_order_line" RENAME CONSTRAINT "sal_order_line_withholding_tax_id_fkey" TO "sal_customer_order_line_withholding_tax_id_fkey";
ALTER INDEX "sal_order_line_item_id_idx" RENAME TO "sal_customer_order_line_item_id_idx";
ALTER INDEX "sal_order_line_order_id_line_no_key" RENAME TO "sal_customer_order_line_order_id_line_no_key";

-- ---- what points at it: the advance bill and the AR item name the Customer
-- Order, so a Sales Order can never be mistaken for it.
ALTER TABLE "sal_advance" RENAME COLUMN "order_id" TO "customer_order_id";
ALTER TABLE "sal_advance" RENAME CONSTRAINT "sal_advance_order_id_fkey" TO "sal_advance_customer_order_id_fkey";
ALTER INDEX "sal_advance_order_id_idx" RENAME TO "sal_advance_customer_order_id_idx";
ALTER TABLE "fin_ar_item" RENAME COLUMN "order_id" TO "customer_order_id";
ALTER TABLE "fin_ar_item" RENAME COLUMN "order_no" TO "customer_order_no";
ALTER INDEX "fin_ar_item_order_id_idx" RENAME TO "fin_ar_item_customer_order_id_idx";

-- ---- numbers: CO/YYYY/MM/NNNN (P78). The order and the AR item's copy of its
-- number move together. Text already written — a posted journal's line
-- description, a Cash Bank Book note, a bill's typed Uraian — is left as it
-- was written; a posted record is not rewritten.
UPDATE "sal_customer_order" SET "order_no" = 'CO/' || substr("order_no", 4) WHERE "order_no" LIKE 'SO/%';
UPDATE "fin_ar_item" SET "customer_order_no" = 'CO/' || substr("customer_order_no", 4) WHERE "customer_order_no" LIKE 'SO/%';

-- ---- the document type, the audit trail and the permissions follow the name;
-- every role keeps its grants because the permission rows are renamed in place.
UPDATE "sys_doc_type"
SET "doc_label" = 'Customer Order', "doc_name" = 'Customer Order', "doc_table" = 'sal_customer_order'
WHERE "doc_table" = 'sal_order';
UPDATE "audit_log" SET "entity_key" = 'sal_customer_order' WHERE "entity_key" = 'sal_order';
UPDATE "sys_permission"
SET "permission_code" = 'CUSTOMER_ORDER_' || substr("permission_code", 13)
WHERE "permission_code" LIKE 'SALES\_ORDER\_%';
