-- Stage 5.1 of production_app_plan.md (P262): what the Workspace's two tables
-- read (W111). The production data of development was reset first, so nothing
-- is converted.

-- The Workspace's Sejak: when a bucket last rose from empty.
ALTER TABLE "prd_balance" ADD COLUMN "entered_at" DATE;

-- Only buckets holding goods, per Unit, stage and Job; empty buckets pile up
-- and are never read.
CREATE INDEX "prd_balance_held_idx" ON "prd_balance" ("unit_id", "stage", "job_id") WHERE "qty_balance" > 0;

-- A Job of several No. Stok has no single one (W103).
ALTER TABLE "prd_job" ALTER COLUMN "tracking_id" DROP NOT NULL;
