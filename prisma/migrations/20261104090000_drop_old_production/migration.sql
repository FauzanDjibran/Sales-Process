-- P218, step D of `Produksi Walet (Real).md`: the production built on P200 goes
-- so the Walet documents are not bent out of it. Posted documents here have
-- journals and stock rows no drop can undo, so a database holding any is
-- refused rather than left with orphans: clear it first (P217).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "prd_execution") OR EXISTS (SELECT 1 FROM "prd_transfer")
     OR EXISTS (SELECT 1 FROM "prd_release") OR EXISTS (SELECT 1 FROM "prd_cost_close") THEN
    RAISE EXCEPTION 'Production documents exist: clear them before dropping their tables (P217).';
  END IF;
END $$;

DROP TABLE "prd_execution_input";
DROP TABLE "prd_execution_output";
DROP TABLE "prd_execution";
DROP TABLE "prd_transfer_line";
DROP TABLE "prd_transfer";
DROP TABLE "prd_release_line";
DROP TABLE "prd_release";
DROP TABLE "prd_cost_close_pool";
DROP TABLE "prd_cost_close_share";
DROP TABLE "prd_cost_close_dest";
DROP TABLE "prd_cost_close_item";
DROP TABLE "prd_cost_close";
DROP TYPE "ProductionDocStatus";

ALTER TABLE "m_item" DROP COLUMN "value_weight";

-- Revalued was the close's value-only movement.
CREATE TYPE "PrdMovement_new" AS ENUM ('Issued', 'Consumed', 'Produced', 'TransferOut', 'TransferIn', 'Released');
ALTER TABLE "prd_ledger" ALTER COLUMN "movement" TYPE "PrdMovement_new" USING ("movement"::text::"PrdMovement_new");
ALTER TYPE "PrdMovement" RENAME TO "PrdMovement_old";
ALTER TYPE "PrdMovement_new" RENAME TO "PrdMovement";
DROP TYPE "PrdMovement_old";

-- The seed deletes nothing, so their permissions and document types go here.
DELETE FROM "sys_role_permission" WHERE "permission_id" IN (
  SELECT "id" FROM "sys_permission"
   WHERE "permission_code" LIKE 'PRODUCTION\_EXECUTION\_%' OR "permission_code" LIKE 'PRODUCTION\_TRANSFER\_%'
      OR "permission_code" LIKE 'PRODUCTION\_RELEASE\_%' OR "permission_code" LIKE 'PRODUCTION\_COST\_CLOSE\_%'
      OR "permission_code" IN ('REPORT_COSTING_SO_FAR_VIEW', 'REPORT_PRODUCTION_RECAP_VIEW'));
DELETE FROM "sys_permission"
 WHERE "permission_code" LIKE 'PRODUCTION\_EXECUTION\_%' OR "permission_code" LIKE 'PRODUCTION\_TRANSFER\_%'
    OR "permission_code" LIKE 'PRODUCTION\_RELEASE\_%' OR "permission_code" LIKE 'PRODUCTION\_COST\_CLOSE\_%'
    OR "permission_code" IN ('REPORT_COSTING_SO_FAR_VIEW', 'REPORT_PRODUCTION_RECAP_VIEW');
DELETE FROM "sys_doc_type" WHERE "doc_table" IN ('prd_execution', 'prd_transfer', 'prd_release', 'prd_cost_close');
