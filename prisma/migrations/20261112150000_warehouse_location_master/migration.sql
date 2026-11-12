-- P267: a location is its own master (Lokasi Gudang), and a warehouse uses
-- locations when it has any — the Gunakan Lokasi switch is dropped.

-- A switched-off warehouse may still carry location rows from before. Those
-- nothing names are removed; any other would leave stock mixed with and
-- without a location, so the migration refuses it.
DELETE FROM "ref_warehouse_location" l
USING "ref_warehouse" w
WHERE w."id" = l."warehouse_id" AND NOT w."use_location"
  AND NOT EXISTS (SELECT 1 FROM "log_stock_ledger" s WHERE s."location_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "log_delivery_note_tracking" p WHERE p."location_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "log_receipt_note_tracking" p WHERE p."location_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "log_stock_issue_tracking" p WHERE p."location_id" = l."id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ref_warehouse" w
    WHERE NOT w."use_location"
      AND EXISTS (SELECT 1 FROM "ref_warehouse_location" l WHERE l."warehouse_id" = w."id")
  ) THEN
    RAISE EXCEPTION 'A warehouse without Gunakan Lokasi still has locations that stock or a document names; resolve it before dropping the switch.';
  END IF;
END $$;

ALTER TABLE "ref_warehouse" DROP COLUMN "use_location";

-- Its own menu, with its own permissions, given to every role that could do
-- the same to a Gudang, so nobody loses what they had on the Lokasi tab.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('WAREHOUSE_LOCATION_VIEW', 'Lihat Lokasi Gudang', 'master', now()),
  ('WAREHOUSE_LOCATION_CREATE', 'Tambah Lokasi Gudang', 'master', now()),
  ('WAREHOUSE_LOCATION_EDIT', 'Ubah Lokasi Gudang', 'master', now()),
  ('WAREHOUSE_LOCATION_ACTIVATE', 'Aktifkan Lokasi Gudang', 'master', now()),
  ('WAREHOUSE_LOCATION_DEACTIVATE', 'Nonaktifkan Lokasi Gudang', 'master', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
JOIN "sys_permission" m ON m."permission_code" = CASE p."permission_code"
  WHEN 'WAREHOUSE_VIEW' THEN 'WAREHOUSE_LOCATION_VIEW'
  WHEN 'WAREHOUSE_CREATE' THEN 'WAREHOUSE_LOCATION_CREATE'
  WHEN 'WAREHOUSE_EDIT' THEN 'WAREHOUSE_LOCATION_EDIT'
  WHEN 'WAREHOUSE_ACTIVATE' THEN 'WAREHOUSE_LOCATION_ACTIVATE'
  WHEN 'WAREHOUSE_DEACTIVATE' THEN 'WAREHOUSE_LOCATION_DEACTIVATE'
END
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
