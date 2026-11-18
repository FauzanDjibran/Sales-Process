-- P282, step 7.2: Kerja (T13). Mulai moves Jobs into Sedang Dikerjakan with their worker;
-- Selesai per line moves them on and, at the Unit's last step, charges the Unit rate
-- with its journal; Batal Mulai sends them back at no cost.
CREATE TYPE "PrdKerjaStatus" AS ENUM ('Running', 'Finished', 'Cancelled');

CREATE TABLE "prd_kerja" (
  "id" SERIAL NOT NULL,
  "kerja_no" TEXT NOT NULL,
  "kerja_date" DATE NOT NULL,
  "unit_id" INTEGER NOT NULL,
  "unit_step_id" INTEGER NOT NULL,
  "partai_id" INTEGER,
  "status" "PrdKerjaStatus" NOT NULL DEFAULT 'Running',
  "note" TEXT,
  "created_by" INTEGER NOT NULL,
  "updated_by" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prd_kerja_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_kerja_kerja_no_key" ON "prd_kerja"("kerja_no");
CREATE INDEX "prd_kerja_unit_id_idx" ON "prd_kerja"("unit_id");
ALTER TABLE "prd_kerja" ADD CONSTRAINT "prd_kerja_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_kerja" ADD CONSTRAINT "prd_kerja_unit_step_id_fkey" FOREIGN KEY ("unit_step_id") REFERENCES "ref_unit_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_kerja" ADD CONSTRAINT "prd_kerja_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "prd_kerja_line" (
  "id" SERIAL NOT NULL,
  "kerja_id" INTEGER NOT NULL,
  "line_no" INTEGER NOT NULL,
  "from_bucket_id" INTEGER NOT NULL,
  "work_bucket_id" INTEGER,
  "to_bucket_id" INTEGER,
  "tracking_id" INTEGER NOT NULL,
  "job_id" INTEGER,
  "employee_id" INTEGER NOT NULL,
  "qty" DECIMAL(18,6) NOT NULL,
  "grams" DECIMAL(18,6),
  "is_rework" BOOLEAN NOT NULL DEFAULT false,
  "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "journal_id" INTEGER,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "closed_by" INTEGER,
  CONSTRAINT "prd_kerja_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_kerja_line_qty_positive" CHECK ("qty" > 0),
  CONSTRAINT "prd_kerja_line_closed_once" CHECK ("finished_at" IS NULL OR "cancelled_at" IS NULL)
);
CREATE UNIQUE INDEX "prd_kerja_line_kerja_id_line_no_key" ON "prd_kerja_line"("kerja_id", "line_no");
CREATE INDEX "prd_kerja_line_work_bucket_id_idx" ON "prd_kerja_line"("work_bucket_id");
ALTER TABLE "prd_kerja_line" ADD CONSTRAINT "prd_kerja_line_kerja_id_fkey" FOREIGN KEY ("kerja_id") REFERENCES "prd_kerja"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_kerja_line" ADD CONSTRAINT "prd_kerja_line_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "prd_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prd_kerja_line" ADD CONSTRAINT "prd_kerja_line_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "m_employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permissions: whoever could post a Pengerjaan Unit starts and finishes Kerja; whoever saw the Workspace sees it.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('PRODUCTION_KERJA_VIEW', 'Lihat Kerja', 'production', 'Proses Kerja: Mulai, Sedang Dikerjakan, Selesai.', now()),
  ('PRODUCTION_KERJA_START', 'Mulai Kerja', 'production', 'Memindah Job ke Sedang Dikerjakan dengan karyawannya.', now()),
  ('PRODUCTION_KERJA_FINISH', 'Selesaikan atau Batal Mulai Kerja', 'production', 'Selesai membebankan biaya Unit bila proses terakhir; Batal Mulai tanpa biaya.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN "sys_permission" m ON m."permission_code" = CASE p."permission_code"
  WHEN 'PRODUCTION_UNIT_VIEW' THEN 'PRODUCTION_KERJA_VIEW'
  WHEN 'PRODUCTION_WORK_POST' THEN 'PRODUCTION_KERJA_START'
END
WHERE p."permission_code" IN ('PRODUCTION_UNIT_VIEW', 'PRODUCTION_WORK_POST')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'PRODUCTION_WORK_POST'
CROSS JOIN "sys_permission" m WHERE m."permission_code" = 'PRODUCTION_KERJA_FINISH'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
