-- One word for the value of goods (Value-Naming-Plan.md, fase 1): base_ is the
-- same measure in the default unit, here rupiah. Names only, save the last statement.
ALTER TABLE "log_receipt_note_line" RENAME COLUMN "value_amount" TO "base_cost_amount";
ALTER TABLE "log_receipt_note_line" RENAME COLUMN "order_dpp_amount" TO "cost_amount";
ALTER TABLE "log_receipt_note" RENAME COLUMN "value_amount" TO "base_cost_amount";
ALTER TABLE "log_receipt_note_tracking" RENAME COLUMN "value_amount" TO "base_cost_amount";
ALTER TABLE "log_stock_receipt" RENAME COLUMN "cost_amount" TO "base_cost_amount";
ALTER TABLE "log_stock_receipt" RENAME COLUMN "written_off_amount" TO "base_written_off_amount";
ALTER TABLE "log_stock_receipt_line" RENAME COLUMN "value_amount" TO "base_cost_amount";
ALTER TABLE "log_stock_receipt_tracking" RENAME COLUMN "value_amount" TO "base_cost_amount";
ALTER TABLE "log_delivery_note" RENAME COLUMN "cost_amount" TO "base_cost_amount";
ALTER TABLE "log_delivery_note_line" RENAME COLUMN "cost_amount" TO "base_cost_amount";
ALTER TABLE "log_delivery_note_tracking" RENAME COLUMN "cost_amount" TO "base_cost_amount";
ALTER TABLE "log_stock_issue" RENAME COLUMN "cost_amount" TO "base_cost_amount";
ALTER TABLE "log_stock_issue_line" RENAME COLUMN "cost_amount" TO "base_cost_amount";
ALTER TABLE "log_stock_issue_tracking" RENAME COLUMN "cost_amount" TO "base_cost_amount";
ALTER TABLE "log_stock_adjustment" RENAME COLUMN "short_amount" TO "base_short_amount";
ALTER TABLE "log_stock_adjustment" RENAME COLUMN "over_amount" TO "base_over_amount";
ALTER TABLE "log_stock_adjustment_line" RENAME COLUMN "typed_value" TO "base_typed_amount";
ALTER TABLE "log_stock_adjustment_line" RENAME COLUMN "value_amount" TO "base_cost_amount";

-- A return is valued in rupiah only, so its cost is its base cost (MC2).
UPDATE "log_receipt_note_line" l SET "cost_amount" = l."base_cost_amount"
FROM "log_receipt_note" n WHERE n."id" = l."receipt_note_id" AND n."purpose" = 'sales_return';
