-- The Database application (P313): its one permission, given to the frozen
-- Administrator role only. No table changes.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at")
VALUES ('MENU_DATABASE_ACCESS', 'Akses aplikasi Database', 'database',
        'Melihat struktur tabel, relasi, dan menu yang memakainya. Tanpa isi data.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "sys_role" r
CROSS JOIN "sys_permission" p
WHERE r."is_system" AND r."role_label" = 'ADMIN' AND p."permission_code" = 'MENU_DATABASE_ACCESS'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
