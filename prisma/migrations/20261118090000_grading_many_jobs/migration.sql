-- P278, step 6.4: one No. Grading holds many Jobs (T6). Each document line (group_no) is a Job
-- taken whole or a loose No. Stok taken in part; its outputs come from its own inputs.
ALTER TABLE "prd_grading_input" ADD COLUMN "group_no" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "job_id" INTEGER;
ALTER TABLE "prd_grading_output" ADD COLUMN "group_no" INTEGER NOT NULL DEFAULT 1;
UPDATE "prd_grading_input" i SET "job_id" = g."job_id" FROM "prd_grading" g WHERE g."id" = i."grading_id";
CREATE INDEX "prd_grading_input_job_id_idx" ON "prd_grading_input"("job_id");
