-- P226: a line has one routing, and one Standard Cost version is active.
-- Neither is a dated version any more, so effective_from goes.

-- One routing per line, and one segment before the partai (the row with no line).
DROP INDEX "prd_routing_line_id_idx";
CREATE UNIQUE INDEX "prd_routing_line_id_key" ON "prd_routing" ("line_id") NULLS NOT DISTINCT;
ALTER TABLE "prd_routing" DROP COLUMN "effective_from";

-- A saved version never changes. Saving a new one closes the active one, so a
-- row is born Inactive and made Active in that same transaction.
ALTER TABLE "prd_rate_version" DROP COLUMN "effective_from";
ALTER TABLE "prd_rate_version" ALTER COLUMN "status" SET DEFAULT 'Inactive';
CREATE UNIQUE INDEX "prd_rate_version_one_active" ON "prd_rate_version" ("status") WHERE "status" = 'Active';

-- The operations no longer exist.
DELETE FROM "sys_role_permission" WHERE "permission_id" IN (
  SELECT "id" FROM "sys_permission" WHERE "permission_code" IN ('RATE_VERSION_EDIT', 'RATE_VERSION_ACTIVATE', 'RATE_VERSION_DEACTIVATE'));
DELETE FROM "sys_permission" WHERE "permission_code" IN ('RATE_VERSION_EDIT', 'RATE_VERSION_ACTIVATE', 'RATE_VERSION_DEACTIVATE');
