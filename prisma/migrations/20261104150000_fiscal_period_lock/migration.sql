-- A fiscal period is Open, Locked (refuses postings, may be unlocked) or Closed
-- (with its year). It never had a Draft of its own: periods are born Open.
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('Open', 'Locked', 'Closed');

ALTER TABLE "acc_fiscal_period" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "acc_fiscal_period"
  ALTER COLUMN "status" TYPE "FiscalPeriodStatus"
  USING (CASE WHEN "status"::text = 'Draft' THEN 'Open' ELSE "status"::text END)::"FiscalPeriodStatus";
ALTER TABLE "acc_fiscal_period" ALTER COLUMN "status" SET DEFAULT 'Open';

-- A close now makes its periods Closed; years closed before this say so too.
UPDATE "acc_fiscal_period" p SET "status" = 'Closed'
FROM "acc_fiscal_year" y WHERE y."id" = p."fiscal_year_id" AND y."status" = 'Closed';
