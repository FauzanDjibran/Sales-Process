-- P284, step 7.4: Packing 95. The ERP's BoM Packing per Nama Jual (the kotak item, P280 §5.4):
-- target gram, tolerance, piece count and bahan penolong per kotak, one active version per
-- item. Produksi's Kotak: pieces from Persiapan of UP5's Assembly step, each with a unique CAIQ,
-- become one new No. Stok of the Nama Jual item in Stand By, valued at the pieces, the UP5 rate
-- per gram of pieces and the bahan penolong used.
CREATE TABLE "prd_bom" (
  "id" SERIAL NOT NULL,
  "bom_code" TEXT NOT NULL,
  "bom_label" TEXT NOT NULL,
  "bom_name" TEXT NOT NULL,
  "item_id" INTEGER NOT NULL,
  "target_grams" DECIMAL(18,6) NOT NULL,
  "tolerance_grams" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "min_pieces" INTEGER NOT NULL,
  "max_pieces" INTEGER NOT NULL,
  "note" TEXT,
  "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
  "created_by" INTEGER NOT NULL,
  "updated_by" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prd_bom_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_bom_target_positive" CHECK ("target_grams" > 0 AND "tolerance_grams" >= 0),
  CONSTRAINT "prd_bom_pieces_range" CHECK ("min_pieces" >= 1 AND "max_pieces" >= "min_pieces")
);
CREATE UNIQUE INDEX "prd_bom_bom_code_key" ON "prd_bom"("bom_code");
CREATE INDEX "prd_bom_item_id_idx" ON "prd_bom"("item_id");
-- One active version per Nama Jual.
CREATE UNIQUE INDEX "prd_bom_one_active" ON "prd_bom"("item_id") WHERE "status" = 'Active';
ALTER TABLE "prd_bom" ADD CONSTRAINT "prd_bom_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_bom_component" (
  "id" SERIAL NOT NULL,
  "bom_id" INTEGER NOT NULL,
  "item_id" INTEGER NOT NULL,
  "qty" DECIMAL(18,4) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "prd_bom_component_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_bom_component_qty_positive" CHECK ("qty" > 0)
);
CREATE UNIQUE INDEX "prd_bom_component_bom_id_item_id_key" ON "prd_bom_component"("bom_id", "item_id");
ALTER TABLE "prd_bom_component" ADD CONSTRAINT "prd_bom_component_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "prd_bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_bom_component" ADD CONSTRAINT "prd_bom_component_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "prd_box" (
  "id" SERIAL NOT NULL,
  "box_doc_no" TEXT NOT NULL,
  "box_date" DATE NOT NULL,
  "unit_id" INTEGER NOT NULL,
  "unit_step_id" INTEGER NOT NULL,
  "bom_id" INTEGER NOT NULL,
  "item_id" INTEGER NOT NULL,
  "partai_id" INTEGER,
  "tracking_id" INTEGER NOT NULL,
  "tracking_no" TEXT NOT NULL,
  "grams" DECIMAL(18,6) NOT NULL,
  "pieces" INTEGER NOT NULL,
  "piece_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cost_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "aux_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "to_bucket_id" INTEGER NOT NULL,
  "journal_id" INTEGER,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prd_box_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_box_value_adds_up" CHECK ("value" = "piece_value" + "cost_amount" + "aux_value")
);
CREATE UNIQUE INDEX "prd_box_box_doc_no_key" ON "prd_box"("box_doc_no");
CREATE UNIQUE INDEX "prd_box_tracking_no_key" ON "prd_box"("tracking_no");
CREATE INDEX "prd_box_unit_id_idx" ON "prd_box"("unit_id");
ALTER TABLE "prd_box" ADD CONSTRAINT "prd_box_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_box" ADD CONSTRAINT "prd_box_unit_step_id_fkey" FOREIGN KEY ("unit_step_id") REFERENCES "ref_unit_step"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_box" ADD CONSTRAINT "prd_box_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "prd_bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_box" ADD CONSTRAINT "prd_box_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "m_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prd_box" ADD CONSTRAINT "prd_box_partai_id_fkey" FOREIGN KEY ("partai_id") REFERENCES "prd_partai"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "prd_box_piece" (
  "id" SERIAL NOT NULL,
  "box_id" INTEGER NOT NULL,
  "line_no" INTEGER NOT NULL,
  "bucket_id" INTEGER NOT NULL,
  "tracking_id" INTEGER NOT NULL,
  "partai_id" INTEGER,
  "grams" DECIMAL(18,6) NOT NULL,
  "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "caiq" TEXT NOT NULL,
  "is_manual" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "prd_box_piece_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_box_piece_box_id_line_no_key" ON "prd_box_piece"("box_id", "line_no");
CREATE UNIQUE INDEX "prd_box_piece_caiq_key" ON "prd_box_piece"("caiq");
ALTER TABLE "prd_box_piece" ADD CONSTRAINT "prd_box_piece_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "prd_box"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "prd_box_component" (
  "id" SERIAL NOT NULL,
  "box_id" INTEGER NOT NULL,
  "item_id" INTEGER NOT NULL,
  "bucket_id" INTEGER NOT NULL,
  "qty" DECIMAL(18,6) NOT NULL,
  "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT "prd_box_component_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prd_box_component_qty_positive" CHECK ("qty" > 0)
);
CREATE INDEX "prd_box_component_box_id_idx" ON "prd_box_component"("box_id");
ALTER TABLE "prd_box_component" ADD CONSTRAINT "prd_box_component_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "prd_box"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissions. BoM Packing is the ERP's (costing), granted with Standard Cost; Kotak is Produksi's,
-- granted to whoever could see the Workspace (view) or post a No. Grading (Tutup Kotak).
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at") VALUES
  ('BOM_PACKING_VIEW', 'Lihat BoM Packing', 'costing', 'Aturan isi kotak per Nama Jual.', now()),
  ('BOM_PACKING_CREATE', 'Tambah BoM Packing', 'costing', NULL, now()),
  ('BOM_PACKING_EDIT', 'Ubah BoM Packing', 'costing', NULL, now()),
  ('BOM_PACKING_ACTIVATE', 'Aktifkan BoM Packing', 'costing', 'Satu versi aktif per Nama Jual.', now()),
  ('BOM_PACKING_DEACTIVATE', 'Nonaktifkan BoM Packing', 'costing', NULL, now()),
  ('PRODUCTION_BOX_VIEW', 'Lihat Kotak', 'production', 'Kotak Packing 95 dan isinya.', now()),
  ('PRODUCTION_BOX_POST', 'Tutup Kotak', 'production', 'Keping dan CAIQ menjadi satu No. Stok kotak di Stand By.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN (VALUES
  ('RATE_VERSION_VIEW', 'BOM_PACKING_VIEW'),
  ('RATE_VERSION_CREATE', 'BOM_PACKING_CREATE'),
  ('RATE_VERSION_CREATE', 'BOM_PACKING_EDIT'),
  ('RATE_VERSION_CREATE', 'BOM_PACKING_ACTIVATE'),
  ('RATE_VERSION_CREATE', 'BOM_PACKING_DEACTIVATE'),
  ('PRODUCTION_UNIT_VIEW', 'PRODUCTION_BOX_VIEW'),
  ('PRODUCTION_GRADING_POST', 'PRODUCTION_BOX_POST')
) AS g("held", "granted") ON g."held" = p."permission_code"
JOIN "sys_permission" m ON m."permission_code" = g."granted"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
