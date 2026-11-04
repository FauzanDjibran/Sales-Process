-- P230: a routing is only the order of Units. How goods leave a Unit and what
-- happens to the No. Job there are the Unit's, as Produksi Walet (Real) §5 draws
-- them. Checkpoint and skippable stay on the step: they are about the order.

ALTER TABLE "ref_unit" ADD COLUMN "exit_mode" "PrdExitMode" NOT NULL DEFAULT 'WithQc',
                       ADD COLUMN "job_policy" "PrdJobPolicy" NOT NULL DEFAULT 'Carried';

UPDATE "ref_unit" u
   SET "exit_mode" = s."exit_mode", "job_policy" = s."job_policy"
  FROM "prd_routing_step" s
 WHERE s."unit_id" = u."id";

ALTER TABLE "prd_routing_step" DROP COLUMN "exit_mode", DROP COLUMN "job_policy";
