-- Permissions of the production reports (P171): whoever could read the Laporan Cost Center keeps the reading of these.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at") VALUES
  ('REPORT_WIP_BALANCE_VIEW', 'Lihat Saldo Produksi', 'production', now()),
  ('REPORT_LOT_CARD_VIEW', 'Lihat Kartu Lot', 'production', now()),
  ('REPORT_TRACE_VIEW', 'Lihat Telusur', 'production', now()),
  ('REPORT_PRODUCTION_RECAP_VIEW', 'Lihat Rekap Produksi', 'production', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", n."id"
  FROM "sys_role_permission" rp
  JOIN "sys_permission" h ON h."id" = rp."permission_id" AND h."permission_code" = 'REPORT_COST_CENTER_VIEW'
  CROSS JOIN "sys_permission" n
 WHERE n."permission_code" IN ('REPORT_WIP_BALANCE_VIEW', 'REPORT_LOT_CARD_VIEW', 'REPORT_TRACE_VIEW', 'REPORT_PRODUCTION_RECAP_VIEW')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
