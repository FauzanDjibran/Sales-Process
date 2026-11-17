-- P274, step 6.1: a Unit is an ordered list of steps (T1); goods wait in the Persiapan of
-- one step (T4); the Standard Cost rate is per Unit step (T3). Written by hand: Prisma
-- cannot map one enum onto another or fold two columns of a Unit into rows.

-- 1. The steps. A Unit's one old process becomes step 1 (Pass Through is now Assign),
--    and a Unit with a QC Check gets QC as its last step.
CREATE TYPE "PrdStepProcess" AS ENUM ('Grading', 'JobOrder', 'Assign', 'Kerja', 'QC', 'Assembly');

CREATE TABLE "ref_unit_step" (
  "id" SERIAL NOT NULL,
  "unit_id" INTEGER NOT NULL,
  "seq" INTEGER NOT NULL,
  "process" "PrdStepProcess" NOT NULL,
  CONSTRAINT "ref_unit_step_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ref_unit_step_unit_id_seq_key" ON "ref_unit_step"("unit_id", "seq");
CREATE UNIQUE INDEX "ref_unit_step_unit_id_process_key" ON "ref_unit_step"("unit_id", "process");
ALTER TABLE "ref_unit_step" ADD CONSTRAINT "ref_unit_step_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ref_unit_step" ("unit_id", "seq", "process")
SELECT "id", 1, (CASE "process"::text WHEN 'Grading' THEN 'Grading' WHEN 'PassThrough' THEN 'Assign' ELSE 'Assembly' END)::"PrdStepProcess"
  FROM "ref_unit";
INSERT INTO "ref_unit_step" ("unit_id", "seq", "process")
SELECT "id", 2, 'QC'::"PrdStepProcess" FROM "ref_unit" WHERE "has_qc" AND "process"::text <> 'Assembly';

ALTER TABLE "ref_unit" ADD COLUMN "allow_reproses" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ref_unit" SET "allow_reproses" = "has_qc";
ALTER TABLE "ref_unit" DROP COLUMN "process", DROP COLUMN "has_qc", DROP COLUMN "releases_job", DROP COLUMN "issues_job_order";
DROP TYPE "PrdProcessKind";

-- 2. The rate is per step: each old rate moves to its Unit's step 1.
ALTER TABLE "prd_rate_version_line" ADD COLUMN "unit_step_id" INTEGER;
UPDATE "prd_rate_version_line" l SET "unit_step_id" = s."id" FROM "ref_unit_step" s WHERE s."unit_id" = l."unit_id" AND s."seq" = 1;
ALTER TABLE "prd_rate_version_line" ALTER COLUMN "unit_step_id" SET NOT NULL;
ALTER TABLE "prd_rate_version_line" DROP COLUMN "unit_id";
CREATE UNIQUE INDEX "prd_rate_version_line_version_id_unit_step_id_key" ON "prd_rate_version_line"("version_id", "unit_step_id");
CREATE INDEX "prd_rate_version_line_unit_step_id_idx" ON "prd_rate_version_line"("unit_step_id");
ALTER TABLE "prd_rate_version_line" ADD CONSTRAINT "prd_rate_version_line_unit_step_id_fkey" FOREIGN KEY ("unit_step_id") REFERENCES "ref_unit_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prd_cost_entry" ADD COLUMN "unit_step_id" INTEGER;
UPDATE "prd_cost_entry" c SET "unit_step_id" = s."id" FROM "ref_unit_step" s WHERE s."unit_id" = c."unit_id" AND s."seq" = 1;
ALTER TABLE "prd_cost_entry" ADD CONSTRAINT "prd_cost_entry_unit_step_id_fkey" FOREIGN KEY ("unit_step_id") REFERENCES "ref_unit_step"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. The buckets and the ledger. Persiapan belongs to a step (goods that were waiting for
--    a Unit's work wait at its step 1); what waited for QC now waits at the QC step.
DROP INDEX "prd_balance_tracking_id_unit_id_stage_partai_id_job_id_qc_c_key";
DROP INDEX "prd_balance_held_idx";

ALTER TABLE "prd_balance" ADD COLUMN "unit_step_id" INTEGER, ADD COLUMN "transit_doc_type_id" INTEGER, ADD COLUMN "transit_doc_id" INTEGER;
ALTER TABLE "prd_ledger" ADD COLUMN "unit_step_id" INTEGER;
UPDATE "prd_balance" b SET "unit_step_id" = s."id" FROM "ref_unit_step" s WHERE s."unit_id" = b."unit_id" AND b."stage"::text = 'Preparation' AND s."seq" = 1;
UPDATE "prd_balance" b SET "unit_step_id" = s."id" FROM "ref_unit_step" s WHERE s."unit_id" = b."unit_id" AND b."stage"::text = 'QcCheck' AND s."process" = 'QC';
UPDATE "prd_ledger" b SET "unit_step_id" = s."id" FROM "ref_unit_step" s WHERE s."unit_id" = b."unit_id" AND b."stage"::text = 'Preparation' AND s."seq" = 1;
UPDATE "prd_ledger" b SET "unit_step_id" = s."id" FROM "ref_unit_step" s WHERE s."unit_id" = b."unit_id" AND b."stage"::text = 'QcCheck' AND s."process" = 'QC';

ALTER TABLE "prd_balance" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TYPE "PrdStage" RENAME TO "PrdStage_old";
CREATE TYPE "PrdStage" AS ENUM ('Preparation', 'Working', 'StandBy', 'InTransit');
ALTER TABLE "prd_balance" ALTER COLUMN "stage" TYPE "PrdStage" USING (CASE "stage"::text WHEN 'QcCheck' THEN 'Preparation' ELSE "stage"::text END)::"PrdStage";
ALTER TABLE "prd_ledger" ALTER COLUMN "stage" TYPE "PrdStage" USING (CASE "stage"::text WHEN 'QcCheck' THEN 'Preparation' ELSE "stage"::text END)::"PrdStage";
ALTER TABLE "prd_balance" ALTER COLUMN "stage" SET DEFAULT 'Preparation';
DROP TYPE "PrdStage_old";

ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_unit_step_id_fkey" FOREIGN KEY ("unit_step_id") REFERENCES "ref_unit_step"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- NULLS NOT DISTINCT, as before; Prisma declares the @@unique but cannot write this.
CREATE UNIQUE INDEX "prd_balance_tracking_id_unit_id_stage_unit_step_id_partai_i_key"
  ON "prd_balance" ("tracking_id", "unit_id", "stage", "unit_step_id", "partai_id", "job_id", "qc_check_id") NULLS NOT DISTINCT;
CREATE INDEX "prd_balance_held_idx" ON "prd_balance" ("unit_id", "stage", "unit_step_id", "job_id") WHERE "qty_balance" > 0;
