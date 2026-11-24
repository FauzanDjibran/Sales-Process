-- Weighing at the Receipt Note (P321).

CREATE TYPE "WeightingResult" AS ENUM ('Within', 'Above', 'Below');

-- An item weighed when it is received: a row means it is.
CREATE TABLE "m_item_weighting" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "item_weight" DECIMAL(18,6) NOT NULL,
    "receiving_tolerance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "m_item_weighting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "m_item_weighting_figures_check" CHECK ("item_weight" > 0 AND "receiving_tolerance" >= 0 AND "receiving_tolerance" < 100)
);
CREATE UNIQUE INDEX "m_item_weighting_item_id_key" ON "m_item_weighting"("item_id");
ALTER TABLE "m_item_weighting" ADD CONSTRAINT "m_item_weighting_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What was weighed of a receipt line; it decides the line's quantity.
CREATE TABLE "log_receipt_note_weighting" (
    "id" SERIAL NOT NULL,
    "receipt_line_id" INTEGER NOT NULL,
    "qty_sj" DECIMAL(18,6) NOT NULL,
    "uom_id" INTEGER NOT NULL,
    "uom_factor" DECIMAL(18,4) NOT NULL,
    "item_weight" DECIMAL(18,6) NOT NULL,
    "qty_calculated" DECIMAL(18,6) NOT NULL,
    "receiving_tolerance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "lower_tolerance" DECIMAL(18,6) NOT NULL,
    "upper_tolerance" DECIMAL(18,6) NOT NULL,
    "qty_weighting" DECIMAL(18,6) NOT NULL,
    "weighting_result" "WeightingResult" NOT NULL,
    "qty_received" DECIMAL(18,6) NOT NULL,
    "qty_bonus" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "log_receipt_note_weighting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "log_receipt_note_weighting_figures_check" CHECK ("qty_weighting" > 0 AND "qty_received" > 0 AND "qty_received" <= "qty_sj" AND "qty_bonus" >= 0)
);
CREATE UNIQUE INDEX "log_receipt_note_weighting_receipt_line_id_key" ON "log_receipt_note_weighting"("receipt_line_id");
ALTER TABLE "log_receipt_note_weighting" ADD CONSTRAINT "log_receipt_note_weighting_receipt_line_id_fkey" FOREIGN KEY ("receipt_line_id") REFERENCES "log_receipt_note_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "log_receipt_note_weighting" ADD CONSTRAINT "log_receipt_note_weighting_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "ref_uom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A Stock Receipt may come from a document of the ERP itself: purpose
-- purchase_bonus names its Receipt Note (weak).
ALTER TABLE "log_stock_receipt"
  ADD COLUMN "source_doc_type_id" INTEGER,
  ADD COLUMN "source_doc_id" INTEGER,
  ADD COLUMN "source_no" TEXT;
CREATE INDEX "log_stock_receipt_source_doc_type_id_source_doc_id_idx" ON "log_stock_receipt"("source_doc_type_id", "source_doc_id");
