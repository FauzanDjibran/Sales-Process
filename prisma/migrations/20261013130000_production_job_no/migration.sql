-- The production identity is named Job No. (M101): prd_batch becomes prd_job,
-- in place, with every key and constraint renamed to match. Numbers already
-- made keep their text (BT/... stays as written; new ones are JOB/...).

ALTER TABLE "prd_batch" RENAME TO "prd_job";
ALTER TABLE "prd_job" RENAME COLUMN "batch_no" TO "job_no";
ALTER TABLE "prd_job" RENAME COLUMN "batch_date" TO "job_date";
ALTER TABLE "prd_job" RENAME CONSTRAINT "prd_batch_pkey" TO "prd_job_pkey";
ALTER SEQUENCE "prd_batch_id_seq" RENAME TO "prd_job_id_seq";
ALTER INDEX "prd_batch_batch_no_key" RENAME TO "prd_job_job_no_key";
ALTER INDEX "prd_batch_source_doc_type_id_source_doc_id_idx" RENAME TO "prd_job_source_doc_type_id_source_doc_id_idx";

ALTER TABLE "prd_batch_parent" RENAME TO "prd_job_parent";
ALTER TABLE "prd_job_parent" RENAME COLUMN "batch_id" TO "job_id";
ALTER TABLE "prd_job_parent" RENAME COLUMN "parent_batch_id" TO "parent_job_id";
ALTER TABLE "prd_job_parent" RENAME CONSTRAINT "prd_batch_parent_pkey" TO "prd_job_parent_pkey";
ALTER SEQUENCE "prd_batch_parent_id_seq" RENAME TO "prd_job_parent_id_seq";
ALTER INDEX "prd_batch_parent_batch_id_parent_batch_id_key" RENAME TO "prd_job_parent_job_id_parent_job_id_key";
ALTER TABLE "prd_job_parent" RENAME CONSTRAINT "prd_batch_parent_batch_id_fkey" TO "prd_job_parent_job_id_fkey";
ALTER TABLE "prd_job_parent" RENAME CONSTRAINT "prd_batch_parent_parent_batch_id_fkey" TO "prd_job_parent_parent_job_id_fkey";

ALTER TABLE "prd_lot" RENAME COLUMN "batch_id" TO "job_id";
ALTER INDEX "prd_lot_batch_id_idx" RENAME TO "prd_lot_job_id_idx";
ALTER TABLE "prd_lot" RENAME CONSTRAINT "prd_lot_batch_id_fkey" TO "prd_lot_job_id_fkey";
