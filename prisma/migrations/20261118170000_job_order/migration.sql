-- P283, step 7.3: Job Order (T7). At a Unit's Job Order step, several No. Stok (in part, if
-- wanted) and one target jenis become one new No. Stok <largest input>-<n> with its own No. Job
-- and Job Order number. Posted in one step; no rate, gram unchanged.
CREATE TABLE "prd_job_order" (
  "id" SERIAL NOT NULL,
  "job_order_doc_no" TEXT NOT NULL,
  "doc_date" DATE NOT NULL,
  "unit_id" INTEGER NOT NULL,
  "unit_step_id" INTEGER NOT NULL,
  "partai_id" INTEGER,
  "journal_id" INTEGER,
  "note" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prd_job_order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_job_order_job_order_doc_no_key" ON "prd_job_order"("job_order_doc_no");
CREATE INDEX "prd_job_order_unit_id_idx" ON "prd_job_order"("unit_id");
ALTER TABLE "prd_job_order" ADD CONSTRAINT "prd_job_order_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_job_order" ADD CONSTRAINT "prd_job_order_unit_step_id_fkey" FOREIGN KEY ("unit_step_id") REFERENCES "ref_unit_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_job_order" ADD CONSTRAINT "prd_job_order_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "prd_job_order_line" (
  "id" SERIAL NOT NULL,
  "job_order_id" INTEGER NOT NULL,
  "line_no" INTEGER NOT NULL,
  "target_item_id" INTEGER NOT NULL,
  "job_order_no" TEXT NOT NULL,
  "grams" DECIMAL(18,6) NOT NULL,
  "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "job_id" INTEGER NOT NULL,
  "tracking_id" INTEGER NOT NULL,
  "tracking_no" TEXT NOT NULL,
  "to_bucket_id" INTEGER NOT NULL,
  CONSTRAINT "prd_job_order_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_job_order_line_grams_positive" CHECK ("grams" > 0)
);
CREATE UNIQUE INDEX "prd_job_order_line_job_order_id_line_no_key" ON "prd_job_order_line"("job_order_id", "line_no");
CREATE UNIQUE INDEX "prd_job_order_line_job_order_no_key" ON "prd_job_order_line"("job_order_no");
ALTER TABLE "prd_job_order_line" ADD CONSTRAINT "prd_job_order_line_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "prd_job_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_job_order_line" ADD CONSTRAINT "prd_job_order_line_target_item_id_fkey" FOREIGN KEY ("target_item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_job_order_line" ADD CONSTRAINT "prd_job_order_line_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "prd_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_job_order_input" (
  "id" SERIAL NOT NULL,
  "job_order_line_id" INTEGER NOT NULL,
  "bucket_id" INTEGER NOT NULL,
  "tracking_id" INTEGER NOT NULL,
  "qty" DECIMAL(18,6) NOT NULL,
  "grams" DECIMAL(18,6) NOT NULL,
  "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT "prd_job_order_input_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_job_order_input_qty_positive" CHECK ("qty" > 0)
);
CREATE INDEX "prd_job_order_input_job_order_line_id_idx" ON "prd_job_order_input"("job_order_line_id");
ALTER TABLE "prd_job_order_input" ADD CONSTRAINT "prd_job_order_input_job_order_line_id_fkey" FOREIGN KEY ("job_order_line_id") REFERENCES "prd_job_order_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissions: whoever could post a No. Grading posts a Job Order; whoever saw the Workspace sees it.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('PRODUCTION_JOB_ORDER_VIEW', 'Lihat Job Order', 'production', 'No. Stok yang dicampur menjadi No. Stok baru dengan No. Job sendiri.', now()),
  ('PRODUCTION_JOB_ORDER_POST', 'Posting Job Order', 'production', 'Langsung diposting; gram tetap, tanpa biaya Unit.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN "sys_permission" m ON m."permission_code" = CASE p."permission_code"
  WHEN 'PRODUCTION_UNIT_VIEW' THEN 'PRODUCTION_JOB_ORDER_VIEW'
  WHEN 'PRODUCTION_GRADING_POST' THEN 'PRODUCTION_JOB_ORDER_POST'
END
WHERE p."permission_code" IN ('PRODUCTION_UNIT_VIEW', 'PRODUCTION_GRADING_POST')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
