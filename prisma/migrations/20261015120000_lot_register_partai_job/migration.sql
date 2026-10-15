-- Walet build step 2 (P163; production_project.md M112, M124, M127, M128):
-- one lot register, the Partai, the Job, and the bucket lot · Job · workstation.

-- 1. log_stock_tracking becomes the one global lot register (M128): a lot
--    number is unique system-wide. Refuse, and list them, if two items share one.
DO $$
DECLARE dup TEXT;
BEGIN
  SELECT string_agg(tracking_no, ', ') INTO dup
    FROM (SELECT tracking_no FROM "log_stock_tracking" GROUP BY tracking_no HAVING COUNT(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Lot numbers used by more than one item: %. Renumber them before this migration.', dup;
  END IF;
END $$;

-- The Job No. of P158 never merged anything a Partai would: refuse rather than drop links.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "prd_job_parent") THEN
    RAISE EXCEPTION 'prd_job_parent holds Job Baru links; a Partai is never merged (M112). Clear production data first.';
  END IF;
END $$;

-- 2. Every production lot onto the register. An issued lot is its stock lot
--    (same item, same number); a produced one is registered with its source.
INSERT INTO "log_stock_tracking" ("tracking_no", "tracking_date", "item_id", "source_doc_type_id", "source_doc_id", "source_no", "expiry_date", "created_by", "updated_at")
SELECT l."lot_no", l."created_at"::date, l."item_id", l."source_doc_type_id", l."source_doc_id", l."source_no", l."expiry_date", l."created_by", now()
  FROM "prd_lot" l
 WHERE NOT EXISTS (SELECT 1 FROM "log_stock_tracking" t WHERE t."item_id" = l."item_id" AND t."tracking_no" = l."lot_no");

CREATE TEMP TABLE lot_map AS
SELECT l."id" AS old_id, t."id" AS new_id, l."job_id" AS partai_id
  FROM "prd_lot" l JOIN "log_stock_tracking" t ON t."item_id" = l."item_id" AND t."tracking_no" = l."lot_no";

ALTER TABLE "prd_balance" DROP CONSTRAINT "prd_balance_lot_id_fkey";
ALTER TABLE "prd_ledger" DROP CONSTRAINT "prd_ledger_lot_id_fkey";
ALTER TABLE "prd_lot_link" DROP CONSTRAINT "prd_lot_link_from_lot_id_fkey";
ALTER TABLE "prd_lot_link" DROP CONSTRAINT "prd_lot_link_to_lot_id_fkey";
DROP INDEX "prd_balance_lot_id_workstation_id_key";

ALTER TABLE "prd_balance" ADD COLUMN "partai_id" INTEGER, ADD COLUMN "job_id" INTEGER, ADD COLUMN "in_transit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "prd_ledger" ADD COLUMN "partai_id" INTEGER, ADD COLUMN "job_id" INTEGER, ADD COLUMN "in_transit" BOOLEAN NOT NULL DEFAULT false;

-- The old Job No. sat on the lot; it is the Partai now, and sits on the bucket.
UPDATE "prd_balance" b SET "lot_id" = m.new_id, "partai_id" = m.partai_id FROM lot_map m WHERE b."lot_id" = m.old_id;
UPDATE "prd_ledger" r SET "lot_id" = m.new_id, "partai_id" = m.partai_id FROM lot_map m WHERE r."lot_id" = m.old_id;
UPDATE "prd_lot_link" k SET "from_lot_id" = m.new_id FROM lot_map m WHERE k."from_lot_id" = m.old_id;
UPDATE "prd_lot_link" k SET "to_lot_id" = m.new_id FROM lot_map m WHERE k."to_lot_id" = m.old_id;

ALTER TABLE "log_stock_issue_lot" DROP COLUMN "prd_lot_id";
DROP TABLE "prd_lot";
DROP TYPE "PrdLotOrigin";

DROP INDEX "log_stock_tracking_item_id_tracking_no_key";
CREATE UNIQUE INDEX "log_stock_tracking_tracking_no_key" ON "log_stock_tracking"("tracking_no");
CREATE INDEX "log_stock_tracking_item_id_idx" ON "log_stock_tracking"("item_id");

-- 3. The Job No. becomes the Partai (M112), renamed in place; its Job Order is new.
DROP TABLE "prd_job_parent";
ALTER TABLE "prd_job" RENAME TO "prd_partai";
ALTER TABLE "prd_partai" RENAME COLUMN "job_no" TO "partai_no";
ALTER TABLE "prd_partai" RENAME COLUMN "job_date" TO "partai_date";
ALTER TABLE "prd_partai" RENAME CONSTRAINT "prd_job_pkey" TO "prd_partai_pkey";
ALTER SEQUENCE "prd_job_id_seq" RENAME TO "prd_partai_id_seq";
ALTER INDEX "prd_job_job_no_key" RENAME TO "prd_partai_partai_no_key";
ALTER INDEX "prd_job_source_doc_type_id_source_doc_id_idx" RENAME TO "prd_partai_source_doc_type_id_source_doc_id_idx";
ALTER TABLE "prd_partai" ADD COLUMN "target_item_id" INTEGER;
ALTER TABLE "prd_partai" ADD CONSTRAINT "prd_partai_target_item_id_fkey" FOREIGN KEY ("target_item_id") REFERENCES "m_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. The Job: a box inside a Partai, and the Jobs it came from.
CREATE TABLE "prd_job" (
    "id" SERIAL NOT NULL,
    "job_no" TEXT NOT NULL,
    "job_date" DATE NOT NULL,
    "partai_id" INTEGER NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_job_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_job_job_no_key" ON "prd_job"("job_no");
CREATE INDEX "prd_job_partai_id_idx" ON "prd_job"("partai_id");
CREATE INDEX "prd_job_source_doc_type_id_source_doc_id_idx" ON "prd_job"("source_doc_type_id", "source_doc_id");
ALTER TABLE "prd_job" ADD CONSTRAINT "prd_job_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_job" ADD CONSTRAINT "prd_job_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_job_parent" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "parent_job_id" INTEGER NOT NULL,

    CONSTRAINT "prd_job_parent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_job_parent_job_id_parent_job_id_key" ON "prd_job_parent"("job_id", "parent_job_id");
ALTER TABLE "prd_job_parent" ADD CONSTRAINT "prd_job_parent_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "prd_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_job_parent" ADD CONSTRAINT "prd_job_parent_parent_job_id_fkey" FOREIGN KEY ("parent_job_id") REFERENCES "prd_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. The bucket is lot · Job · workstation, or in transit to it (M113, M127).
--    NULLS NOT DISTINCT: goods outside a Job still have one bucket per lot and place.
CREATE UNIQUE INDEX "prd_balance_bucket_key" ON "prd_balance"("lot_id", "job_id", "workstation_id", "in_transit") NULLS NOT DISTINCT;
CREATE INDEX "prd_balance_partai_id_idx" ON "prd_balance"("partai_id");
CREATE INDEX "prd_balance_job_id_idx" ON "prd_balance"("job_id");

ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "prd_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prd_ledger" ADD CONSTRAINT "prd_ledger_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_lot_link" ADD CONSTRAINT "prd_lot_link_from_lot_id_fkey" FOREIGN KEY ("from_lot_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_lot_link" ADD CONSTRAINT "prd_lot_link_to_lot_id_fkey" FOREIGN KEY ("to_lot_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
