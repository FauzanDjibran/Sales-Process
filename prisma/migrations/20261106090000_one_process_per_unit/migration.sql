-- W64, W65, W73: one Unit does one kind of work, Pembentuk Partai is no process,
-- Grading Mix and Job Order are gone (W68), QC Check is the Unit's, and how goods
-- leave is worked out from the routing and the Workstation, never typed.

ALTER TYPE "PrdJobPolicy" ADD VALUE 'ReleasedWithOrder';

ALTER TYPE "PrdProcessKind" RENAME TO "PrdProcessKind_old";
CREATE TYPE "PrdProcessKind" AS ENUM ('PassThrough', 'Grading', 'Assembly');

ALTER TABLE "ref_unit" ADD COLUMN "process" "PrdProcessKind" NOT NULL DEFAULT 'PassThrough',
                       ADD COLUMN "has_qc" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ref_unit"
   SET "process" = CASE
     WHEN 'Assembly' = ANY("processes") THEN 'Assembly'::"PrdProcessKind"
     WHEN 'PassThrough' = ANY("processes") THEN 'PassThrough'::"PrdProcessKind"
     WHEN "processes" = '{}' THEN 'PassThrough'::"PrdProcessKind"
     ELSE 'Grading'::"PrdProcessKind"
   END;

ALTER TABLE "ref_unit" DROP COLUMN "processes", DROP COLUMN "exit_mode";

DROP TYPE "PrdProcessKind_old";
DROP TYPE "PrdExitMode";
