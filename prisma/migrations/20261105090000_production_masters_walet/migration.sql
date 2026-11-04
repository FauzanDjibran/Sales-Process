-- Step 1 of the Walet production plan (P225, W33): Unit and Workstation become
-- masters, with Line, Routing, Standard Cost, Karyawan and the BJL flag.
--
-- The old ref_workstation (P201) held goods, so it is what the plan calls a
-- Unit: it is renamed in place and every table pointing at it keeps its rows.
-- The new ref_workstation only groups Units.

CREATE TYPE "PrdProcessKind" AS ENUM ('PassThrough', 'Grading', 'PartaiFormer', 'GradingMix', 'JobOrder', 'Assembly');
CREATE TYPE "PrdExitMode" AS ENUM ('Direct', 'NoQc', 'WithQc', 'PerCarton');
CREATE TYPE "PrdJobPolicy" AS ENUM ('Issued', 'Carried', 'Released', 'None');

-- The old Workstation becomes Unit.
ALTER TABLE "ref_workstation" RENAME TO "ref_unit";
ALTER TABLE "ref_unit" RENAME COLUMN "workstation_code" TO "unit_code";
ALTER TABLE "ref_unit" RENAME COLUMN "workstation_label" TO "unit_label";
ALTER TABLE "ref_unit" RENAME COLUMN "workstation_name" TO "unit_name";
ALTER TABLE "ref_unit" RENAME CONSTRAINT "ref_workstation_pkey" TO "ref_unit_pkey";
ALTER INDEX "ref_workstation_workstation_code_key" RENAME TO "ref_unit_unit_code_key";
ALTER SEQUENCE "ref_workstation_id_seq" RENAME TO "ref_unit_id_seq";
UPDATE "ref_unit" SET "unit_code" = 'unit.' || substr("unit_code", 4) WHERE "unit_code" LIKE 'ws.%';

ALTER TABLE "prd_balance" RENAME COLUMN "workstation_id" TO "unit_id";
ALTER TABLE "prd_ledger" RENAME COLUMN "workstation_id" TO "unit_id";
ALTER TABLE "log_stock_issue" RENAME COLUMN "workstation_id" TO "unit_id";
ALTER TABLE "prd_balance" RENAME CONSTRAINT "prd_balance_workstation_id_fkey" TO "prd_balance_unit_id_fkey";
ALTER TABLE "prd_ledger" RENAME CONSTRAINT "prd_ledger_workstation_id_fkey" TO "prd_ledger_unit_id_fkey";
ALTER TABLE "log_stock_issue" RENAME CONSTRAINT "log_stock_issue_workstation_id_fkey" TO "log_stock_issue_unit_id_fkey";
ALTER INDEX "prd_balance_workstation_id_idx" RENAME TO "prd_balance_unit_id_idx";
ALTER INDEX "prd_balance_tracking_id_workstation_id_key" RENAME TO "prd_balance_tracking_id_unit_id_key";

-- The audit trail and the role grants follow the name.
UPDATE "audit_log" SET "entity_key" = 'ref_unit' WHERE "entity_key" = 'ref_workstation';
UPDATE "sys_permission"
   SET "permission_code" = replace("permission_code", 'WORKSTATION_', 'UNIT_'),
       "permission_name" = replace("permission_name", 'Workstation', 'Unit'),
       "updated_at" = now()
 WHERE "permission_code" LIKE 'WORKSTATION\_%';

-- The new Workstation: a group of Units.
CREATE TABLE "ref_workstation" (
    "id" SERIAL NOT NULL,
    "workstation_code" TEXT NOT NULL,
    "workstation_label" TEXT NOT NULL,
    "workstation_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ref_workstation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ref_workstation_workstation_code_key" ON "ref_workstation"("workstation_code");

ALTER TABLE "ref_unit" ADD COLUMN "workstation_id" INTEGER,
                       ADD COLUMN "processes" "PrdProcessKind"[];
CREATE INDEX "ref_unit_workstation_id_idx" ON "ref_unit"("workstation_id");
ALTER TABLE "ref_unit" ADD CONSTRAINT "ref_unit_workstation_id_fkey" FOREIGN KEY ("workstation_id") REFERENCES "ref_workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Line, routing and its steps.
CREATE TABLE "prd_line" (
    "id" SERIAL NOT NULL,
    "line_code" TEXT NOT NULL,
    "line_label" TEXT NOT NULL,
    "line_name" TEXT NOT NULL,
    "variance_account_id" INTEGER,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_line_line_code_key" ON "prd_line"("line_code");
ALTER TABLE "prd_line" ADD CONSTRAINT "prd_line_variance_account_id_fkey" FOREIGN KEY ("variance_account_id") REFERENCES "acc_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "prd_routing" (
    "id" SERIAL NOT NULL,
    "routing_code" TEXT NOT NULL,
    "routing_label" TEXT NOT NULL,
    "routing_name" TEXT NOT NULL,
    "line_id" INTEGER,
    "effective_from" DATE NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_routing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_routing_routing_code_key" ON "prd_routing"("routing_code");
CREATE INDEX "prd_routing_line_id_idx" ON "prd_routing"("line_id");
ALTER TABLE "prd_routing" ADD CONSTRAINT "prd_routing_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "prd_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "prd_routing_step" (
    "id" SERIAL NOT NULL,
    "routing_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "exit_mode" "PrdExitMode" NOT NULL,
    "job_policy" "PrdJobPolicy" NOT NULL,
    "is_checkpoint" BOOLEAN NOT NULL DEFAULT false,
    "is_skippable" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "prd_routing_step_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_routing_step_routing_id_seq_key" ON "prd_routing_step"("routing_id", "seq");
CREATE UNIQUE INDEX "prd_routing_step_routing_id_unit_id_key" ON "prd_routing_step"("routing_id", "unit_id");
CREATE INDEX "prd_routing_step_unit_id_idx" ON "prd_routing_step"("unit_id");
ALTER TABLE "prd_routing_step" ADD CONSTRAINT "prd_routing_step_routing_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "prd_routing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_routing_step" ADD CONSTRAINT "prd_routing_step_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard cost versions.
CREATE TABLE "prd_rate_version" (
    "id" SERIAL NOT NULL,
    "rate_code" TEXT NOT NULL,
    "rate_label" TEXT NOT NULL,
    "rate_name" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prd_rate_version_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_rate_version_rate_code_key" ON "prd_rate_version"("rate_code");

CREATE TABLE "prd_rate_version_line" (
    "id" SERIAL NOT NULL,
    "version_id" INTEGER NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    CONSTRAINT "prd_rate_version_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prd_rate_version_line_version_id_unit_id_key" ON "prd_rate_version_line"("version_id", "unit_id");
CREATE INDEX "prd_rate_version_line_unit_id_idx" ON "prd_rate_version_line"("unit_id");
ALTER TABLE "prd_rate_version_line" ADD CONSTRAINT "prd_rate_version_line_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prd_rate_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prd_rate_version_line" ADD CONSTRAINT "prd_rate_version_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "ref_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Karyawan.
CREATE TABLE "m_employee" (
    "id" SERIAL NOT NULL,
    "employee_code" TEXT NOT NULL,
    "employee_label" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "m_employee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "m_employee_employee_code_key" ON "m_employee"("employee_code");

-- BJL on the Item (W32).
ALTER TABLE "m_item" ADD COLUMN "is_bjl" BOOLEAN NOT NULL DEFAULT false;

-- One No. Stok is one stock in the whole system (W10). Fails if two items
-- already share a number; that data must be sorted out by hand.
DROP INDEX "log_stock_tracking_item_id_tracking_no_key";
CREATE UNIQUE INDEX "log_stock_tracking_tracking_no_key" ON "log_stock_tracking"("tracking_no");

-- Permissions of the new masters go to every role that could see Units.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at")
SELECT n.code || '_' || a.act, a.verb || ' ' || n.label, 'master', now()
FROM (VALUES ('WORKSTATION', 'Workstation'), ('LINE', 'Line Produksi'), ('ROUTING', 'Routing'),
             ('RATE_VERSION', 'Standard Cost'), ('EMPLOYEE', 'Karyawan')) AS n(code, label)
CROSS JOIN (VALUES ('VIEW', 'Lihat'), ('CREATE', 'Tambah'), ('EDIT', 'Ubah'),
                   ('ACTIVATE', 'Aktifkan'), ('DEACTIVATE', 'Nonaktifkan')) AS a(act, verb)
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", np."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" op ON op."id" = rp."permission_id" AND op."permission_code" LIKE 'UNIT\_%'
JOIN "sys_permission" np ON np."permission_code" = regexp_replace(op."permission_code", '^UNIT_', 'WORKSTATION_')
                         OR np."permission_code" = regexp_replace(op."permission_code", '^UNIT_', 'LINE_')
                         OR np."permission_code" = regexp_replace(op."permission_code", '^UNIT_', 'ROUTING_')
                         OR np."permission_code" = regexp_replace(op."permission_code", '^UNIT_', 'RATE_VERSION_')
                         OR np."permission_code" = regexp_replace(op."permission_code", '^UNIT_', 'EMPLOYEE_')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
