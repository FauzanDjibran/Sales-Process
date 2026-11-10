-- Which Units a user may open in the Produksi application (P260,
-- production_app_plan.md §6.1). user_id carries no foreign key, as created_by
-- carries none, so no shared table points into Produksi.
CREATE TABLE "prd_user_unit" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prd_user_unit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prd_user_unit_user_id_unit_id_key" ON "prd_user_unit"("user_id", "unit_id");
CREATE INDEX "prd_user_unit_unit_id_idx" ON "prd_user_unit"("unit_id");

ALTER TABLE "prd_user_unit" ADD CONSTRAINT "prd_user_unit_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PRODUCTION_UNIT_ALL: every Unit, for supervisors, PPIC and administrators.
-- Every role that can open the Workspace today gets it, so nobody loses a Unit
-- until an administrator starts assigning them.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "description", "updated_at")
VALUES ('PRODUCTION_UNIT_ALL', 'Buka semua Unit', 'production',
        'Tanpa ini, user hanya membuka Unit yang ditugaskan kepadanya di form User.', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'PRODUCTION_UNIT_VIEW'
CROSS JOIN "sys_permission" m
WHERE m."permission_code" = 'PRODUCTION_UNIT_ALL'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
