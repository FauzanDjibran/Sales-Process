-- Stage 5.3 of production_app_plan.md: a No. Grading takes a Job whole (W97,
-- W107), its buckets in prd_grading_input; goods without a Job still take one
-- No. Stok in part (W96). Production data of development was reset in 5.1, so
-- nothing is converted; a database still holding a grading is refused.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "prd_grading") THEN
    RAISE EXCEPTION 'prd_grading holds documents: reset production data first (db:reset-production).';
  END IF;
END $$;

-- DropIndex
DROP INDEX "prd_grading_bucket_id_idx";

-- AlterTable
ALTER TABLE "prd_grading" DROP COLUMN "bucket_id",
DROP COLUMN "qty",
ADD COLUMN     "job_id" INTEGER;

-- CreateTable
CREATE TABLE "prd_grading_input" (
    "id" SERIAL NOT NULL,
    "grading_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "grams" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "prd_grading_input_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prd_grading_input_bucket_id_idx" ON "prd_grading_input"("bucket_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_grading_input_grading_id_line_no_key" ON "prd_grading_input"("grading_id", "line_no");

-- CreateIndex
CREATE INDEX "prd_grading_job_id_idx" ON "prd_grading"("job_id");

-- AddForeignKey
ALTER TABLE "prd_grading" ADD CONSTRAINT "prd_grading_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "prd_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_grading_input" ADD CONSTRAINT "prd_grading_input_grading_id_fkey" FOREIGN KEY ("grading_id") REFERENCES "prd_grading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

