-- P287 step 1: the Sales Return, goods of one Customer Order coming back from
-- its posted Delivery Notes. It posts nothing; the Receipt Note brings them in.


-- CreateEnum
CREATE TYPE "SalesReturnStatus" AS ENUM ('Draft', 'Submitted', 'Open', 'Closed', 'Cancelled', 'Rejected');

-- CreateTable
CREATE TABLE "sal_return" (
    "id" SERIAL NOT NULL,
    "return_no" TEXT NOT NULL,
    "return_date" DATE NOT NULL,
    "status" "SalesReturnStatus" NOT NULL DEFAULT 'Draft',
    "customer_order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reason_note" TEXT,
    "customer_return_no" TEXT,
    "customer_return_date" DATE,
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sal_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sal_return_line" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "delivery_note_id" INTEGER NOT NULL,
    "delivery_note_line_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "base_qty" DECIMAL(18,4) NOT NULL,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "sal_return_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sal_return_return_no_key" ON "sal_return"("return_no");

-- CreateIndex
CREATE INDEX "sal_return_customer_order_id_idx" ON "sal_return"("customer_order_id");

-- CreateIndex
CREATE INDEX "sal_return_status_return_date_idx" ON "sal_return"("status", "return_date");

-- CreateIndex
CREATE INDEX "sal_return_line_delivery_note_line_id_idx" ON "sal_return_line"("delivery_note_line_id");

-- CreateIndex
CREATE INDEX "sal_return_line_item_id_idx" ON "sal_return_line"("item_id");

-- CreateIndex
CREATE INDEX "sal_return_line_uom_id_idx" ON "sal_return_line"("uom_id");

-- CreateIndex
CREATE UNIQUE INDEX "sal_return_line_return_id_line_no_key" ON "sal_return_line"("return_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "sal_return_line_return_id_delivery_note_line_id_key" ON "sal_return_line"("return_id", "delivery_note_line_id");

-- AddForeignKey
ALTER TABLE "sal_return" ADD CONSTRAINT "sal_return_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "sal_customer_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_return" ADD CONSTRAINT "sal_return_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "m_partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_return" ADD CONSTRAINT "sal_return_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "m_partner_address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_return_line" ADD CONSTRAINT "sal_return_line_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sal_return"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_return_line" ADD CONSTRAINT "sal_return_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sal_return_line" ADD CONSTRAINT "sal_return_line_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A line returns something, and its receipts never exceed it.
ALTER TABLE "sal_return_line" ADD CONSTRAINT "sal_return_line_qty_positive" CHECK ("base_qty" > 0);
ALTER TABLE "sal_return_line" ADD CONSTRAINT "sal_return_line_received_within" CHECK ("received_qty" >= 0 AND "received_qty" <= "base_qty");

-- Its own menu entry and permissions, given to every role that may do the same
-- to a Customer Order: a return is approved the way an order is.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('SALES_RETURN_VIEW', 'Lihat Sales Return', 'sales', 'Termasuk yang masih Draft, ditolak dan dibatalkan.', now()),
  ('SALES_RETURN_CREATE', 'Buat Sales Return', 'sales', 'Membuat Draft dari Delivery Note yang sudah diposting.', now()),
  ('SALES_RETURN_EDIT', 'Ubah Sales Return', 'sales', 'Hanya selama masih Draft.', now()),
  ('SALES_RETURN_SUBMIT', 'Ajukan Sales Return', 'sales', 'Mengunci Draft untuk disetujui.', now()),
  ('SALES_RETURN_APPROVE', 'Setujui / Tolak Sales Return', 'sales', 'Sales Return yang disetujui dapat diterima gudang.', now()),
  ('SALES_RETURN_CANCEL', 'Batalkan Sales Return', 'sales', 'Hanya Draft, dengan alasan.', now()),
  ('SALES_RETURN_CLOSE', 'Tutup Sales Return', 'sales', 'Menutup Sales Return Open, dengan alasan.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN (VALUES
  ('CUSTOMER_ORDER_VIEW', 'SALES_RETURN_VIEW'),
  ('CUSTOMER_ORDER_CREATE', 'SALES_RETURN_CREATE'),
  ('CUSTOMER_ORDER_EDIT', 'SALES_RETURN_EDIT'),
  ('CUSTOMER_ORDER_SUBMIT', 'SALES_RETURN_SUBMIT'),
  ('CUSTOMER_ORDER_APPROVE', 'SALES_RETURN_APPROVE'),
  ('CUSTOMER_ORDER_CANCEL', 'SALES_RETURN_CANCEL'),
  ('CUSTOMER_ORDER_CLOSE', 'SALES_RETURN_CLOSE')
) AS g("held", "granted") ON g."held" = p."permission_code"
JOIN "sys_permission" m ON m."permission_code" = g."granted"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
