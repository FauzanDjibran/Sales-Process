-- P268: a Delivery Note's tracking rows are the detail — lot, location, stock
-- status, base quantity and the value the stock released — and its line is
-- the summary. A unit cost is a division of two stored figures, never stored.

ALTER TABLE "log_delivery_note_tracking" ADD COLUMN "stock_status_id" INTEGER;
-- Every pick so far left from Tersedia, the only status issued from (P120).
UPDATE "log_delivery_note_tracking" SET "stock_status_id" = (SELECT "id" FROM "sys_stock_status" WHERE "status_label" = 'TERSEDIA');
ALTER TABLE "log_delivery_note_tracking" ALTER COLUMN "stock_status_id" SET NOT NULL;
ALTER TABLE "log_delivery_note_tracking" ADD CONSTRAINT "log_delivery_note_tracking_stock_status_id_fkey"
  FOREIGN KEY ("stock_status_id") REFERENCES "sys_stock_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The base quantity becomes the truth: a Draft's picks had it only at Posting.
UPDATE "log_delivery_note_tracking" p
SET "base_qty" = ROUND(p."qty" * l."uom_factor", 4)
FROM "log_delivery_note_line" l
WHERE l."id" = p."delivery_note_line_id" AND p."base_qty" = 0;
ALTER TABLE "log_delivery_note_tracking" ALTER COLUMN "base_qty" DROP DEFAULT;
ALTER TABLE "log_delivery_note_tracking" DROP COLUMN "qty";
ALTER TABLE "log_delivery_note_tracking" DROP COLUMN "unit_cost";
ALTER TABLE "log_delivery_note_line" DROP COLUMN "unit_cost";

-- A pick is a bucket: lot, location and status.
DROP INDEX "log_delivery_note_tracking_pick_key";
CREATE UNIQUE INDEX "log_delivery_note_tracking_pick_key" ON "log_delivery_note_tracking"
  ("delivery_note_line_id", "tracking_id", "location_id", "stock_status_id") NULLS NOT DISTINCT;
