-- P114: a unit cost describes a stock movement — its value ÷ its quantity —
-- and is never read back into a calculation; it is kept at six decimals so a
-- cost per gram or ml reads truly. Values stay whole rupiah.
ALTER TABLE "tmp_item_cost" ALTER COLUMN "unit_cost" TYPE DECIMAL(18,6);
ALTER TABLE "tmp_stock_movement" ALTER COLUMN "unit_cost" TYPE DECIMAL(18,6);
ALTER TABLE "log_delivery_note_line" ALTER COLUMN "unit_cost" TYPE DECIMAL(18,6);
ALTER TABLE "log_delivery_note_lot" ALTER COLUMN "unit_cost" TYPE DECIMAL(18,6);
