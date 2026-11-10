-- The two applications' menus (P257, production_app_plan.md §4). The money side
-- of production becomes an ERP module of its own, so every role that could open
-- Tagihan Biaya, Standard Cost or Jenis Biaya keeps them by holding its menu;
-- Karyawan moves to the Produksi application, so a role that could open it
-- keeps it by holding that application's menu. Module columns follow the
-- catalogue (the seed would rewrite them too). No table changes.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at")
VALUES ('MENU_COSTING_ACCESS', 'Akses menu Produksi di ERP', 'costing',
        'Sisi uang produksi: Tagihan Biaya, Standard Cost, Jenis Biaya.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id"
  AND p."permission_code" IN ('PRODUCTION_COST_BILL_VIEW', 'RATE_VERSION_VIEW', 'COST_TYPE_VIEW')
CROSS JOIN "sys_permission" m
WHERE m."permission_code" = 'MENU_COSTING_ACCESS'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'EMPLOYEE_VIEW'
CROSS JOIN "sys_permission" m
WHERE m."permission_code" = 'MENU_PRODUCTION_ACCESS'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

UPDATE "sys_permission" SET "module" = 'costing', "updated_at" = now()
WHERE "permission_code" LIKE 'PRODUCTION\_COST\_BILL\_%' OR "permission_code" LIKE 'RATE\_VERSION\_%'
   OR "permission_code" LIKE 'COST\_TYPE\_%';
UPDATE "sys_permission" SET "module" = 'production', "updated_at" = now()
WHERE "permission_code" LIKE 'EMPLOYEE\_%';
