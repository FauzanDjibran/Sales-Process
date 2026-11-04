-- Step 3 of the Walet plan (P228): the Stock Issue becomes BSTB Issue, moving
-- goods at Terima (W20, W22). From Ajukan the goods are locked at the sender.

ALTER TYPE "StockIssueStatus" ADD VALUE 'Submitted' AFTER 'Draft';

-- What Submitted documents hold of a bucket; the books do not move until Terima.
ALTER TABLE "log_stock_balance" ADD COLUMN "reserved_qty" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "log_stock_balance" ADD CONSTRAINT "log_stock_balance_reserved_check" CHECK ("reserved_qty" >= 0 AND "reserved_qty" <= "qty_balance");

UPDATE "sys_doc_type" SET "doc_label" = 'BSTB Issue', "doc_name" = 'BSTB Issue', "updated_at" = now() WHERE "doc_table" = 'log_stock_issue';

INSERT INTO "sys_permission" ("permission_code", "permission_name", "module", "updated_at")
VALUES ('STOCK_ISSUE_SUBMIT', 'Ajukan BSTB Issue', 'inventory', now())
ON CONFLICT ("permission_code") DO NOTHING;

INSERT INTO "sys_role_permission" ("role_id", "permission_id")
SELECT rp."role_id", m."id"
FROM "sys_role_permission" rp
JOIN "sys_permission" p ON p."id" = rp."permission_id" AND p."permission_code" = 'STOCK_ISSUE_POST'
CROSS JOIN "sys_permission" m
WHERE m."permission_code" = 'STOCK_ISSUE_SUBMIT'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
