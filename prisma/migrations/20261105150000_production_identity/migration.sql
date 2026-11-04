-- Step 2 of the Walet plan (P227): the identities of production and the bucket
-- they make up. Also takes back P226's one routing per line for now (W35).

-- A line may have several routings; each names its line. The segment before
-- the partai, which has no line, stays single.
DROP INDEX "prd_routing_line_id_key";
CREATE INDEX "prd_routing_line_id_idx" ON "prd_routing"("line_id");
CREATE UNIQUE INDEX "prd_routing_one_segment" ON "prd_routing" ((line_id IS NULL)) WHERE "line_id" IS NULL;

CREATE TYPE "PrdStage" AS ENUM ('Preparation', 'StandBy');
CREATE TYPE "PrdStockForm" AS ENUM ('Bulk', 'Piece', 'Box');

CREATE TABLE "prd_partai" (
    "id" SERIAL NOT NULL,
    "partai_no" TEXT NOT NULL,
    "partai_date" DATE NOT NULL,
    "line_id" INTEGER NOT NULL,
    "routing_id" INTEGER NOT NULL,
    "rate_version_id" INTEGER NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_partai_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_partai_partai_no_key" ON "prd_partai"("partai_no");
CREATE INDEX "prd_partai_line_id_idx" ON "prd_partai"("line_id");
CREATE INDEX "prd_partai_routing_id_idx" ON "prd_partai"("routing_id");
ALTER TABLE "prd_partai" ADD CONSTRAINT "prd_partai_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "prd_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_partai" ADD CONSTRAINT "prd_partai_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "prd_routing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_partai" ADD CONSTRAINT "prd_partai_rate_version_id_fkey" FOREIGN KEY ("rate_version_id") REFERENCES "prd_rate_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_job" (
    "id" SERIAL NOT NULL,
    "job_no" TEXT NOT NULL,
    "job_date" DATE NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "partai_id" INTEGER,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_job_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_job_job_no_key" ON "prd_job"("job_no");
CREATE INDEX "prd_job_tracking_id_idx" ON "prd_job"("tracking_id");
CREATE INDEX "prd_job_partai_id_idx" ON "prd_job"("partai_id");
ALTER TABLE "prd_job" ADD CONSTRAINT "prd_job_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_job" ADD CONSTRAINT "prd_job_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_job" ADD CONSTRAINT "prd_job_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "prd_tracking_info" (
    "id" SERIAL NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "rate_version_id" INTEGER NOT NULL,
    "routing_id" INTEGER,
    "grams" DECIMAL(18,6),
    "form" "PrdStockForm" NOT NULL DEFAULT 'Bulk',
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_tracking_info_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_tracking_info_tracking_id_key" ON "prd_tracking_info"("tracking_id");
CREATE INDEX "prd_tracking_info_routing_id_idx" ON "prd_tracking_info"("routing_id");
ALTER TABLE "prd_tracking_info" ADD CONSTRAINT "prd_tracking_info_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_tracking_info" ADD CONSTRAINT "prd_tracking_info_rate_version_id_fkey" FOREIGN KEY ("rate_version_id") REFERENCES "prd_rate_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_tracking_info" ADD CONSTRAINT "prd_tracking_info_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "prd_routing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "prd_cost_entry" (
    "id" SERIAL NOT NULL,
    "posting_date" DATE NOT NULL,
    "source_doc_type_id" INTEGER NOT NULL,
    "source_doc_id" INTEGER NOT NULL,
    "source_no" TEXT NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "rate_version_id" INTEGER NOT NULL,
    "tracking_id" INTEGER NOT NULL,
    "partai_id" INTEGER,
    "line_id" INTEGER,
    "grams" DECIMAL(18,6) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_cost_entry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "prd_cost_entry_posting_date_idx" ON "prd_cost_entry"("posting_date");
CREATE INDEX "prd_cost_entry_source_doc_type_id_source_doc_id_idx" ON "prd_cost_entry"("source_doc_type_id", "source_doc_id");
ALTER TABLE "prd_cost_entry" ADD CONSTRAINT "prd_cost_entry_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_cost_entry" ADD CONSTRAINT "prd_cost_entry_rate_version_id_fkey" FOREIGN KEY ("rate_version_id") REFERENCES "prd_rate_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_cost_entry" ADD CONSTRAINT "prd_cost_entry_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "log_stock_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_cost_entry" ADD CONSTRAINT "prd_cost_entry_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prd_cost_entry" ADD CONSTRAINT "prd_cost_entry_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "prd_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The bucket: No. Stok · Unit · tahap · Partai · Job. What production holds
-- today came in by Stock Issue and has not been worked, so it is Persiapan.
ALTER TABLE "prd_balance" ADD COLUMN "stage" "PrdStage" NOT NULL DEFAULT 'Preparation',
                          ADD COLUMN "partai_id" INTEGER,
                          ADD COLUMN "job_id" INTEGER;
DROP INDEX "prd_balance_tracking_id_unit_id_key";
CREATE UNIQUE INDEX "prd_balance_tracking_id_unit_id_stage_partai_id_job_id_key" ON "prd_balance" ("tracking_id", "unit_id", "stage", "partai_id", "job_id") NULLS NOT DISTINCT;
CREATE INDEX "prd_balance_partai_id_idx" ON "prd_balance"("partai_id");
CREATE INDEX "prd_balance_job_id_idx" ON "prd_balance"("job_id");
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prd_balance" ADD CONSTRAINT "prd_balance_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "prd_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "prd_ledger" ADD COLUMN "stage" "PrdStage" NOT NULL DEFAULT 'Preparation',
                         ADD COLUMN "partai_id" INTEGER,
                         ADD COLUMN "job_id" INTEGER;
ALTER TABLE "prd_ledger" ALTER COLUMN "stage" DROP DEFAULT;
CREATE INDEX "prd_ledger_partai_id_idx" ON "prd_ledger"("partai_id");
ALTER TABLE "prd_ledger" ADD CONSTRAINT "prd_ledger_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prd_ledger" ADD CONSTRAINT "prd_ledger_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "prd_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
