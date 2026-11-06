-- W92: every move between Units carries the No. Job or makes one, so a Unit only
-- says whether its grading releases the No. Job and whether its goods leave with
-- a Job Order. What the five policies said beyond that follows from the goods.

ALTER TABLE "ref_unit" ADD COLUMN "releases_job" BOOLEAN NOT NULL DEFAULT false,
                       ADD COLUMN "issues_job_order" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ref_unit"
   SET "releases_job" = "job_policy" IN ('Released', 'ReleasedWithOrder') AND "process" = 'Grading',
       "issues_job_order" = "job_policy" = 'ReleasedWithOrder';

ALTER TABLE "ref_unit" DROP COLUMN "job_policy";

DROP TYPE "PrdJobPolicy";
