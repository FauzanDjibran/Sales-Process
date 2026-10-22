-- Walet build step 3, data (a migration of its own: a new enum value cannot be
-- used in the transaction that adds it).
--
-- A Stock Issue posted before step 3 placed its goods at the workstation at
-- once, never in transit: it is Diterima, on the day it was posted, into the
-- bucket it entered.
UPDATE "log_stock_issue"
   SET "status" = 'Received', "received_date" = "issue_date", "received_by" = "updated_by"
 WHERE "status" = 'Posted';

UPDATE "log_stock_issue_lot" p
   SET "received_bucket_id" = p."prd_bucket_id"
  FROM "log_stock_issue_line" x JOIN "log_stock_issue" s ON s."id" = x."stock_issue_id"
 WHERE p."stock_issue_line_id" = x."id" AND s."status" = 'Received' AND p."received_bucket_id" IS NULL;

-- Receiving is the workstation's step (M113). Whoever could post a Stock Issue
-- could, until now, place goods at a station: they keep that by Terima / Tolak.
INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at")
VALUES ('STOCK_ISSUE_RECEIVE', 'Terima / Tolak Stock Issue', 'inventory', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
  FROM "sys_role_permission" rp
  JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'STOCK_ISSUE_POST'
 CROSS JOIN "sys_permission" m
 WHERE m."permission_code" = 'STOCK_ISSUE_RECEIVE'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
