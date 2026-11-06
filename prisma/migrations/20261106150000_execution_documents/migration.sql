-- Menus 9-11 of the plan: Dokumen Grading, Pengerjaan Unit and QC Check. A bucket
-- gains the QC Check stage, its Balik QC row (W66) and the mark that it is
-- bahan penolong (V8), which W37 kept apart only by the issue's purpose.

ALTER TYPE "PrdStage" ADD VALUE 'QcCheck' BEFORE 'StandBy';

CREATE TYPE "PrdDocStatus" AS ENUM ('Draft', 'Posted', 'Cancelled');
CREATE TYPE "PrdQcDecision" AS ENUM ('Pass', 'Return');

ALTER TABLE "prd_balance" ADD COLUMN "auxiliary" BOOLEAN NOT NULL DEFAULT false,
                          ADD COLUMN "qc_check_id" INTEGER;
ALTER TABLE "prd_cost_entry" ADD COLUMN "is_rework" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX "prd_balance_tracking_id_unit_id_stage_partai_id_job_id_key";
CREATE UNIQUE INDEX "prd_balance_tracking_id_unit_id_stage_partai_id_job_id_qc_c_key"
  ON "prd_balance" ("tracking_id", "unit_id", "stage", "partai_id", "job_id", "qc_check_id") NULLS NOT DISTINCT;

UPDATE "prd_balance" b SET "auxiliary" = true
  FROM "log_stock_issue_tracking" t
  JOIN "log_stock_issue_line" l ON l."id" = t."stock_issue_line_id"
  JOIN "log_stock_issue" s ON s."id" = l."stock_issue_id"
 WHERE t."prd_bucket_id" = b."id" AND s."purpose" = 'auxiliary_issue';

CREATE TABLE "prd_grading" (
    "id" SERIAL NOT NULL,
    "grading_no" TEXT NOT NULL,
    "grading_date" DATE NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "status" "PrdDocStatus" NOT NULL DEFAULT 'Draft',
    "bucket_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "grams" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "input_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aux_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "scrap_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_grading_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_grading_grading_no_key" ON "prd_grading"("grading_no");
CREATE INDEX "prd_grading_unit_id_idx" ON "prd_grading"("unit_id");
CREATE INDEX "prd_grading_bucket_id_idx" ON "prd_grading"("bucket_id");
ALTER TABLE "prd_grading" ADD CONSTRAINT "prd_grading_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_grading_output" (
    "id" SERIAL NOT NULL,
    "grading_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "grams" DECIMAL(18,6) NOT NULL,
    "is_bjl" BOOLEAN NOT NULL DEFAULT false,
    "tracking_id" INTEGER,
    "tracking_no" TEXT,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "to_bucket_id" INTEGER,
    CONSTRAINT "prd_grading_output_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_grading_output_grading_id_line_no_key" ON "prd_grading_output"("grading_id", "line_no");
CREATE INDEX "prd_grading_output_item_id_idx" ON "prd_grading_output"("item_id");
ALTER TABLE "prd_grading_output" ADD CONSTRAINT "prd_grading_output_grading_id_fkey" FOREIGN KEY ("grading_id") REFERENCES "prd_grading"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_grading_output" ADD CONSTRAINT "prd_grading_output_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_work" (
    "id" SERIAL NOT NULL,
    "work_no" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "status" "PrdDocStatus" NOT NULL DEFAULT 'Draft',
    "result_note" TEXT,
    "rate" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aux_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "scrap_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" INTEGER,
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_work_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_work_work_no_key" ON "prd_work"("work_no");
CREATE INDEX "prd_work_unit_id_idx" ON "prd_work"("unit_id");
ALTER TABLE "prd_work" ADD CONSTRAINT "prd_work_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_work_line" (
    "id" SERIAL NOT NULL,
    "work_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "job_id" INTEGER,
    "employee_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "grams" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "input_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aux_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "to_bucket_id" INTEGER,
    CONSTRAINT "prd_work_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_work_line_work_id_line_no_key" ON "prd_work_line"("work_id", "line_no");
CREATE INDEX "prd_work_line_bucket_id_idx" ON "prd_work_line"("bucket_id");
CREATE INDEX "prd_work_line_job_id_idx" ON "prd_work_line"("job_id");
CREATE INDEX "prd_work_line_employee_id_idx" ON "prd_work_line"("employee_id");
ALTER TABLE "prd_work_line" ADD CONSTRAINT "prd_work_line_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "prd_work"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_work_line" ADD CONSTRAINT "prd_work_line_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "m_employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_aux_use" (
    "id" SERIAL NOT NULL,
    "grading_id" INTEGER,
    "work_id" INTEGER,
    "line_no" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "job_id" INTEGER,
    "qty" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    CONSTRAINT "prd_aux_use_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prd_aux_use_one_document" CHECK (("grading_id" IS NULL) <> ("work_id" IS NULL))
);
CREATE INDEX "prd_aux_use_grading_id_idx" ON "prd_aux_use"("grading_id");
CREATE INDEX "prd_aux_use_work_id_idx" ON "prd_aux_use"("work_id");
ALTER TABLE "prd_aux_use" ADD CONSTRAINT "prd_aux_use_grading_id_fkey" FOREIGN KEY ("grading_id") REFERENCES "prd_grading"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_aux_use" ADD CONSTRAINT "prd_aux_use_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "prd_work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "prd_qc_check" (
    "id" SERIAL NOT NULL,
    "qc_no" TEXT NOT NULL,
    "qc_date" DATE NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "status" "PrdDocStatus" NOT NULL DEFAULT 'Draft',
    "inspector" TEXT,
    "note" TEXT,
    "status_reason" TEXT,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_qc_check_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_qc_check_qc_no_key" ON "prd_qc_check"("qc_no");
CREATE INDEX "prd_qc_check_unit_id_idx" ON "prd_qc_check"("unit_id");
ALTER TABLE "prd_qc_check" ADD CONSTRAINT "prd_qc_check_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_qc_check_line" (
    "id" SERIAL NOT NULL,
    "qc_check_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "decision" "PrdQcDecision",
    "reason" TEXT,
    "to_bucket_id" INTEGER,
    CONSTRAINT "prd_qc_check_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_qc_check_line_qc_check_id_line_no_key" ON "prd_qc_check_line"("qc_check_id", "line_no");
CREATE INDEX "prd_qc_check_line_bucket_id_idx" ON "prd_qc_check_line"("bucket_id");
ALTER TABLE "prd_qc_check_line" ADD CONSTRAINT "prd_qc_check_line_qc_check_id_fkey" FOREIGN KEY ("qc_check_id") REFERENCES "prd_qc_check"("id") ON DELETE CASCADE ON UPDATE CASCADE;
