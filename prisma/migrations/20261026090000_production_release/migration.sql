-- CreateTable
CREATE TABLE "prd_release" (
    "id" SERIAL NOT NULL,
    "release_no" TEXT NOT NULL,
    "release_date" DATE NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'Draft',
    "purpose" TEXT NOT NULL,
    "workstation_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER,
    "reason" TEXT,
    "note" TEXT,
    "cancel_reason" TEXT,
    "journal_id" INTEGER,
    "total_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prd_release_line" (
    "id" SERIAL NOT NULL,
    "release_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "source_bucket_id" INTEGER NOT NULL,
    "lot_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "lot_no" TEXT NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "location_id" INTEGER,
    "partai_id" INTEGER,
    "job_id" INTEGER,
    "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "prd_release_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prd_release_release_no_key" ON "prd_release"("release_no");

-- CreateIndex
CREATE INDEX "prd_release_purpose_status_release_date_idx" ON "prd_release"("purpose", "status", "release_date");

-- CreateIndex
CREATE INDEX "prd_release_workstation_id_idx" ON "prd_release"("workstation_id");

-- CreateIndex
CREATE INDEX "prd_release_line_release_id_source_bucket_id_idx" ON "prd_release_line"("release_id", "source_bucket_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_release_line_release_id_line_no_key" ON "prd_release_line"("release_id", "line_no");

-- AddForeignKey
ALTER TABLE "prd_release" ADD CONSTRAINT "prd_release_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_release" ADD CONSTRAINT "prd_release_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "ref_warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_release_line" ADD CONSTRAINT "prd_release_line_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "prd_release"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "prd_release_line" ADD CONSTRAINT "prd_release_line_qty_positive" CHECK ("qty" > 0);

-- Permissions of the two documents (P170): the nearest hand-over permission keeps the matching one.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('PRODUCTION_RECEIPT_VIEW', 'Lihat Penerimaan Hasil Produksi', 'production', now()),
  ('PRODUCTION_RECEIPT_CREATE', 'Buat Penerimaan Hasil Produksi', 'production', now()),
  ('PRODUCTION_RECEIPT_EDIT', 'Ubah Penerimaan Hasil Produksi', 'production', now()),
  ('PRODUCTION_RECEIPT_POST', 'Posting Penerimaan Hasil Produksi', 'production', now()),
  ('PRODUCTION_RECEIPT_CANCEL', 'Batalkan Penerimaan Hasil Produksi', 'production', now()),
  ('PRODUCTION_SCRAP_VIEW', 'Lihat Pemusnahan Produksi', 'production', now()),
  ('PRODUCTION_SCRAP_CREATE', 'Buat Pemusnahan Produksi', 'production', now()),
  ('PRODUCTION_SCRAP_EDIT', 'Ubah Pemusnahan Produksi', 'production', now()),
  ('PRODUCTION_SCRAP_POST', 'Posting Pemusnahan Produksi', 'production', now()),
  ('PRODUCTION_SCRAP_CANCEL', 'Batalkan Pemusnahan Produksi', 'production', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", n."id"
  FROM (VALUES
    ('PRODUCTION_HANDOVER_VIEW', 'PRODUCTION_RECEIPT_VIEW'),
    ('PRODUCTION_HANDOVER_CREATE', 'PRODUCTION_RECEIPT_CREATE'),
    ('PRODUCTION_HANDOVER_EDIT', 'PRODUCTION_RECEIPT_EDIT'),
    ('PRODUCTION_HANDOVER_POST', 'PRODUCTION_RECEIPT_POST'),
    ('PRODUCTION_HANDOVER_CANCEL', 'PRODUCTION_RECEIPT_CANCEL'),
    ('PRODUCTION_HANDOVER_VIEW', 'PRODUCTION_SCRAP_VIEW'),
    ('PRODUCTION_HANDOVER_CREATE', 'PRODUCTION_SCRAP_CREATE'),
    ('PRODUCTION_HANDOVER_EDIT', 'PRODUCTION_SCRAP_EDIT'),
    ('PRODUCTION_HANDOVER_POST', 'PRODUCTION_SCRAP_POST'),
    ('PRODUCTION_HANDOVER_CANCEL', 'PRODUCTION_SCRAP_CANCEL')
  ) AS m(held, given)
  JOIN "sys_permission" h ON h."permission_code" = m.held
  JOIN "sys_role_permission" rp ON rp."permission_id" = h."id"
  JOIN "sys_permission" n ON n."permission_code" = m.given
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
