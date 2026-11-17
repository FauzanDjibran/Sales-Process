-- P277, step 6.3: Dokumen Push and BSTB between Units (T8). Made and posted (Push) or
-- submitted (BSTB) in one step, received by the Unit a BSTB goes to; no journal.
CREATE TYPE "PrdTransferKind" AS ENUM ('Push', 'Bstb', 'BstbPartai');
CREATE TYPE "PrdTransferStatus" AS ENUM ('Submitted', 'Posted');

CREATE TABLE "prd_transfer" (
  "id" SERIAL NOT NULL,
  "transfer_no" TEXT NOT NULL,
  "kind" "PrdTransferKind" NOT NULL,
  "transfer_date" DATE NOT NULL,
  "from_unit_id" INTEGER NOT NULL,
  "to_unit_id" INTEGER NOT NULL,
  "partai_id" INTEGER,
  "line_id" INTEGER,
  "routing_id" INTEGER,
  "status" "PrdTransferStatus" NOT NULL,
  "received_at" DATE,
  "received_by" INTEGER,
  "note" TEXT,
  "created_by" INTEGER NOT NULL,
  "updated_by" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prd_transfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_transfer_units_differ" CHECK ("from_unit_id" <> "to_unit_id")
);
CREATE UNIQUE INDEX "prd_transfer_transfer_no_key" ON "prd_transfer"("transfer_no");
CREATE INDEX "prd_transfer_from_unit_id_idx" ON "prd_transfer"("from_unit_id");
CREATE INDEX "prd_transfer_to_unit_id_status_idx" ON "prd_transfer"("to_unit_id", "status");
ALTER TABLE "prd_transfer" ADD CONSTRAINT "prd_transfer_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_transfer" ADD CONSTRAINT "prd_transfer_to_unit_id_fkey" FOREIGN KEY ("to_unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_transfer" ADD CONSTRAINT "prd_transfer_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prd_transfer" ADD CONSTRAINT "prd_transfer_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "prd_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "prd_transfer_line" (
  "id" SERIAL NOT NULL,
  "transfer_id" INTEGER NOT NULL,
  "line_no" INTEGER NOT NULL,
  "from_bucket_id" INTEGER NOT NULL,
  "tracking_id" INTEGER NOT NULL,
  "job_id" INTEGER,
  "is_new_job" BOOLEAN NOT NULL DEFAULT false,
  "qty" DECIMAL(18,6) NOT NULL,
  "grams" DECIMAL(18,6),
  "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "transit_bucket_id" INTEGER,
  "to_bucket_id" INTEGER,
  CONSTRAINT "prd_transfer_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_transfer_line_qty_positive" CHECK ("qty" > 0)
);
CREATE UNIQUE INDEX "prd_transfer_line_transfer_id_line_no_key" ON "prd_transfer_line"("transfer_id", "line_no");
ALTER TABLE "prd_transfer_line" ADD CONSTRAINT "prd_transfer_line_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "prd_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_transfer_line" ADD CONSTRAINT "prd_transfer_line_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "prd_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions: whoever could see the Workspace sees the transfers; whoever could post a QC Check
-- sends and receives, so nobody loses a step they had.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('PRODUCTION_TRANSFER_VIEW', 'Lihat Push dan BSTB', 'production', 'Dokumen perpindahan barang antar Unit.', now()),
  ('PRODUCTION_TRANSFER_CREATE', 'Kirim Push atau BSTB', 'production', 'Push langsung diposting; BSTB diajukan dan menunggu Terima.', now()),
  ('PRODUCTION_TRANSFER_RECEIVE', 'Terima BSTB', 'production', 'Oleh Unit tujuan; barang masuk ke Persiapannya.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN "sys_permission" m ON m."permission_code" = CASE p."permission_code"
  WHEN 'PRODUCTION_UNIT_VIEW' THEN 'PRODUCTION_TRANSFER_VIEW'
  WHEN 'PRODUCTION_QC_POST' THEN 'PRODUCTION_TRANSFER_CREATE'
END
WHERE p."permission_code" IN ('PRODUCTION_UNIT_VIEW', 'PRODUCTION_QC_POST')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'PRODUCTION_QC_POST'
CROSS JOIN "sys_permission" m WHERE m."permission_code" = 'PRODUCTION_TRANSFER_RECEIVE'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
