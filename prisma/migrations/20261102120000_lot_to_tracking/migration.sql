-- The system names a lot "tracking" (log_stock_tracking is the register); the
-- screens still say Lot. Pure renames: no data moves.

-- Tables
ALTER TABLE "log_delivery_note_lot" RENAME TO "log_delivery_note_tracking";
ALTER TABLE "log_receipt_note_lot" RENAME TO "log_receipt_note_tracking";
ALTER TABLE "log_stock_issue_lot" RENAME TO "log_stock_issue_tracking";
ALTER TABLE "prd_lot_link" RENAME TO "prd_tracking_link";

-- Columns
ALTER TABLE "log_delivery_note_tracking" RENAME COLUMN "lot_id" TO "tracking_id";
ALTER TABLE "log_delivery_note_tracking" RENAME COLUMN "lot_no" TO "tracking_no";
ALTER TABLE "log_receipt_note_tracking" RENAME COLUMN "lot_seq" TO "tracking_seq";
ALTER TABLE "log_receipt_note_tracking" RENAME COLUMN "lot_no" TO "tracking_no";
ALTER TABLE "log_stock_issue_tracking" RENAME COLUMN "lot_id" TO "tracking_id";
ALTER TABLE "log_stock_issue_tracking" RENAME COLUMN "lot_no" TO "tracking_no";
ALTER TABLE "prd_balance" RENAME COLUMN "lot_id" TO "tracking_id";
ALTER TABLE "prd_ledger" RENAME COLUMN "lot_id" TO "tracking_id";
ALTER TABLE "prd_execution_input" RENAME COLUMN "lot_id" TO "tracking_id";
ALTER TABLE "prd_execution_output" RENAME COLUMN "lot_id" TO "tracking_id";
ALTER TABLE "prd_execution_output" RENAME COLUMN "lot_no" TO "tracking_no";
ALTER TABLE "prd_transfer_line" RENAME COLUMN "lot_id" TO "tracking_id";
ALTER TABLE "prd_release_line" RENAME COLUMN "lot_id" TO "tracking_id";
ALTER TABLE "prd_tracking_link" RENAME COLUMN "from_lot_id" TO "from_tracking_id";
ALTER TABLE "prd_tracking_link" RENAME COLUMN "to_lot_id" TO "to_tracking_id";

-- Keys and constraints, to the names Prisma gives them
ALTER TABLE "log_delivery_note_tracking" RENAME CONSTRAINT "log_delivery_note_lot_pkey" TO "log_delivery_note_tracking_pkey";
ALTER TABLE "log_delivery_note_tracking" RENAME CONSTRAINT "log_delivery_note_lot_delivery_note_line_id_fkey" TO "log_delivery_note_tracking_delivery_note_line_id_fkey";
ALTER TABLE "log_receipt_note_tracking" RENAME CONSTRAINT "log_receipt_note_lot_pkey" TO "log_receipt_note_tracking_pkey";
ALTER TABLE "log_receipt_note_tracking" RENAME CONSTRAINT "log_receipt_note_lot_line_id_fkey" TO "log_receipt_note_tracking_line_id_fkey";
ALTER TABLE "log_stock_issue_tracking" RENAME CONSTRAINT "log_stock_issue_lot_pkey" TO "log_stock_issue_tracking_pkey";
ALTER TABLE "log_stock_issue_tracking" RENAME CONSTRAINT "log_stock_issue_lot_stock_issue_line_id_fkey" TO "log_stock_issue_tracking_stock_issue_line_id_fkey";
ALTER TABLE "prd_balance" RENAME CONSTRAINT "prd_balance_lot_id_fkey" TO "prd_balance_tracking_id_fkey";
ALTER TABLE "prd_ledger" RENAME CONSTRAINT "prd_ledger_lot_id_fkey" TO "prd_ledger_tracking_id_fkey";
ALTER TABLE "prd_tracking_link" RENAME CONSTRAINT "prd_lot_link_pkey" TO "prd_tracking_link_pkey";
ALTER TABLE "prd_tracking_link" RENAME CONSTRAINT "prd_lot_link_from_bucket_id_fkey" TO "prd_tracking_link_from_bucket_id_fkey";
ALTER TABLE "prd_tracking_link" RENAME CONSTRAINT "prd_lot_link_from_lot_id_fkey" TO "prd_tracking_link_from_tracking_id_fkey";
ALTER TABLE "prd_tracking_link" RENAME CONSTRAINT "prd_lot_link_to_lot_id_fkey" TO "prd_tracking_link_to_tracking_id_fkey";

-- Indexes
ALTER INDEX "log_delivery_note_lot_delivery_note_line_id_pick_no_key" RENAME TO "log_delivery_note_tracking_delivery_note_line_id_pick_no_key";
ALTER INDEX "log_delivery_note_lot_lot_id_idx" RENAME TO "log_delivery_note_tracking_tracking_id_idx";
ALTER INDEX "log_delivery_note_lot_pick_key" RENAME TO "log_delivery_note_tracking_pick_key";
ALTER INDEX "log_receipt_note_lot_line_id_lot_seq_key" RENAME TO "log_receipt_note_tracking_line_id_tracking_seq_key";
ALTER INDEX "log_stock_issue_lot_lot_id_idx" RENAME TO "log_stock_issue_tracking_tracking_id_idx";
ALTER INDEX "log_stock_issue_lot_pick_key" RENAME TO "log_stock_issue_tracking_pick_key";
ALTER INDEX "log_stock_issue_lot_stock_issue_line_id_pick_no_key" RENAME TO "log_stock_issue_tracking_stock_issue_line_id_pick_no_key";
ALTER INDEX "prd_balance_lot_id_workstation_id_key" RENAME TO "prd_balance_tracking_id_workstation_id_key";
ALTER INDEX "prd_execution_output_lot_id_idx" RENAME TO "prd_execution_output_tracking_id_idx";
ALTER INDEX "prd_ledger_lot_id_idx" RENAME TO "prd_ledger_tracking_id_idx";
ALTER INDEX "prd_lot_link_from_lot_id_idx" RENAME TO "prd_tracking_link_from_tracking_id_idx";
ALTER INDEX "prd_lot_link_source_doc_type_id_source_doc_id_idx" RENAME TO "prd_tracking_link_source_doc_type_id_source_doc_id_idx";
ALTER INDEX "prd_lot_link_to_lot_id_idx" RENAME TO "prd_tracking_link_to_tracking_id_idx";

-- Sequences
ALTER SEQUENCE "log_receipt_note_lot_id_seq" RENAME TO "log_receipt_note_tracking_id_seq";
ALTER SEQUENCE "log_stock_issue_lot_id_seq" RENAME TO "log_stock_issue_tracking_id_seq";
ALTER SEQUENCE "prd_lot_link_id_seq" RENAME TO "prd_tracking_link_id_seq";
