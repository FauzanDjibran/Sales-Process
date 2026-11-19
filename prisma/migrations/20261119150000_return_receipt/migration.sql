-- P288 step 2: the Receipt Note learns purpose sales_return. A returned lot
-- names the Delivery Note tracking row it left on and the status it comes back
-- under; a Delivery Note line keeps what came back of it.

ALTER TABLE "log_delivery_note_line" ADD COLUMN "returned_qty" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "log_delivery_note_line" ADD CONSTRAINT "log_delivery_note_line_returned_within"
  CHECK ("returned_qty" >= 0 AND "returned_qty" <= "base_qty");

ALTER TABLE "log_receipt_note_tracking" ADD COLUMN "source_tracking_id" INTEGER,
ADD COLUMN "stock_status_id" INTEGER;

CREATE INDEX "log_receipt_note_tracking_source_tracking_id_idx" ON "log_receipt_note_tracking"("source_tracking_id");
