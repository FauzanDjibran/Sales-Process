-- Logistik and Persediaan become one module, Persediaan (P131). Every role that
-- could open the Logistik menu keeps its documents by holding the Persediaan
-- menu; the Logistik menu permission then goes (the seed would remove it too,
-- as it is no longer in the catalogue). No table changes.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at")
VALUES ('MENU_INVENTORY_ACCESS', 'Akses menu Persediaan', 'inventory', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'MENU_LOGISTICS_ACCESS'
CROSS JOIN "sys_permission" m
WHERE m."permission_code" = 'MENU_INVENTORY_ACCESS'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DELETE FROM "sys_role_permission"
WHERE "permission_id" IN (SELECT "id" FROM "sys_permission" WHERE "permission_code" = 'MENU_LOGISTICS_ACCESS');
DELETE FROM "sys_permission" WHERE "permission_code" = 'MENU_LOGISTICS_ACCESS';

UPDATE "sys_permission" SET "module" = 'inventory', "updated_at" = now() WHERE "module" = 'logistics';
