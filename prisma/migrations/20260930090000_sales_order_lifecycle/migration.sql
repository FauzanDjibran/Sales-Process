-- The Sales Order's new lifecycle (Claude-ERP.md P63):
--   Draft → Submitted → Open → Closed, Cancelled from Draft, Rejected from
--   Submitted. A confirmed order is what an Open order now is, so the value is
--   renamed in place and every stored order keeps its meaning.
ALTER TYPE "SalesOrderStatus" RENAME VALUE 'Confirmed' TO 'Open';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'Submitted' BEFORE 'Open';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'Closed' AFTER 'Open';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'Rejected' AFTER 'Cancelled';

-- One reason column for whichever final step the order took.
ALTER TABLE "sal_order" RENAME COLUMN "cancel_reason" TO "status_reason";

-- The warehouse is chosen where goods leave — the Surat Jalan — and the
-- delivery date belongs to the delivery schedule derived from the order
-- (P63). Neither is part of the Sales Order any more.
ALTER TABLE "sal_order" DROP CONSTRAINT "sal_order_warehouse_id_fkey";
ALTER TABLE "sal_order" DROP COLUMN "warehouse_id";
ALTER TABLE "sal_order" DROP COLUMN "requested_date";

-- Konfirmasi became Ajukan; the permission keeps its role grants under its
-- new code. Setujui / Tolak and Tutup Pesanan get new permissions from the
-- seed.
UPDATE "sys_permission"
SET "permission_code" = 'SALES_ORDER_SUBMIT'
WHERE "permission_code" = 'SALES_ORDER_CONFIRM';
