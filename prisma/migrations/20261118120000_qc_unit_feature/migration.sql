-- P281, step 7.1 (P279): QC is a feature of the Unit, not a step; the Standard Cost rate
-- is one per Unit, charged once when its last process is posted. Written by hand: Prisma
-- cannot drop an enum value in use or fold step rates into a Unit's.

-- 1. The Unit carries QC.
ALTER TABLE "ref_unit" ADD COLUMN "has_qc" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ref_unit" u SET "has_qc" = true WHERE EXISTS (SELECT 1 FROM "ref_unit_step" s WHERE s."unit_id" = u."id" AND s."process" = 'QC');

-- 2. The stage QC Check returns: what waited at a QC step now waits in it, with no step.
ALTER TABLE "prd_balance" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TYPE "PrdStage" RENAME TO "PrdStage_old";
CREATE TYPE "PrdStage" AS ENUM ('Preparation', 'Working', 'QcCheck', 'StandBy', 'InTransit');
ALTER TABLE "prd_balance" ALTER COLUMN "stage" TYPE "PrdStage" USING "stage"::text::"PrdStage";
ALTER TABLE "prd_ledger" ALTER COLUMN "stage" TYPE "PrdStage" USING "stage"::text::"PrdStage";
ALTER TABLE "prd_balance" ALTER COLUMN "stage" SET DEFAULT 'Preparation';
DROP TYPE "PrdStage_old";
UPDATE "prd_balance" b SET "stage" = 'QcCheck', "unit_step_id" = NULL FROM "ref_unit_step" s WHERE s."id" = b."unit_step_id" AND s."process" = 'QC';
UPDATE "prd_ledger" b SET "stage" = 'QcCheck', "unit_step_id" = NULL FROM "ref_unit_step" s WHERE s."id" = b."unit_step_id" AND s."process" = 'QC';

-- 3. One rate per Unit: the step rates of a version are added up per Unit.
ALTER TABLE "prd_rate_version_line" ADD COLUMN "unit_id" INTEGER;
UPDATE "prd_rate_version_line" l SET "unit_id" = s."unit_id" FROM "ref_unit_step" s WHERE s."id" = l."unit_step_id";
UPDATE "prd_rate_version_line" l SET "rate" = t."total"
  FROM (SELECT min("id") AS "id", sum("rate") AS "total" FROM "prd_rate_version_line" GROUP BY "version_id", "unit_id") t WHERE l."id" = t."id";
DELETE FROM "prd_rate_version_line" WHERE "id" NOT IN (SELECT min("id") FROM "prd_rate_version_line" GROUP BY "version_id", "unit_id");
ALTER TABLE "prd_rate_version_line" DROP CONSTRAINT "prd_rate_version_line_unit_step_id_fkey";
DROP INDEX "prd_rate_version_line_version_id_unit_step_id_key";
DROP INDEX "prd_rate_version_line_unit_step_id_idx";
ALTER TABLE "prd_rate_version_line" DROP COLUMN "unit_step_id";
ALTER TABLE "prd_rate_version_line" ALTER COLUMN "unit_id" SET NOT NULL;
CREATE UNIQUE INDEX "prd_rate_version_line_version_id_unit_id_key" ON "prd_rate_version_line"("version_id", "unit_id");
CREATE INDEX "prd_rate_version_line_unit_id_idx" ON "prd_rate_version_line"("unit_id");
ALTER TABLE "prd_rate_version_line" ADD CONSTRAINT "prd_rate_version_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. A cost entry is the Unit's.
ALTER TABLE "prd_cost_entry" DROP CONSTRAINT "prd_cost_entry_unit_step_id_fkey";
ALTER TABLE "prd_cost_entry" DROP COLUMN "unit_step_id";

-- 5. QC leaves the steps.
DELETE FROM "ref_unit_step" WHERE "process" = 'QC';
ALTER TYPE "PrdStepProcess" RENAME TO "PrdStepProcess_old";
CREATE TYPE "PrdStepProcess" AS ENUM ('Grading', 'JobOrder', 'Assign', 'Kerja', 'Assembly');
ALTER TABLE "ref_unit_step" ALTER COLUMN "process" TYPE "PrdStepProcess" USING "process"::text::"PrdStepProcess";
DROP TYPE "PrdStepProcess_old";
