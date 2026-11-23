-- One word per state across documents (P312): what is on the way, and what arrived (P317).
ALTER TYPE "HandoverStatus" RENAME VALUE 'Submitted' TO 'InTransit';
ALTER TYPE "HandoverStatus" RENAME VALUE 'Posted' TO 'Received';
ALTER TYPE "StockIssueStatus" RENAME VALUE 'Submitted' TO 'InTransit';
ALTER TYPE "StockIssueStatus" RENAME VALUE 'Posted' TO 'Received';
ALTER TABLE "prd_receipt" ALTER COLUMN "status" SET DEFAULT 'InTransit';
ALTER TABLE "prd_issue" ALTER COLUMN "status" SET DEFAULT 'InTransit';
ALTER TABLE "log_stock_receipt" ALTER COLUMN "status" SET DEFAULT 'InTransit';
