/*
  Warnings:

  - You are about to drop the `cash_bank_layer` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "cash_bank_layer" DROP CONSTRAINT "cash_bank_layer_cash_bank_id_fkey";

-- DropForeignKey
ALTER TABLE "cash_bank_layer" DROP CONSTRAINT "cash_bank_layer_source_doc_type_id_fkey";

-- DropTable
DROP TABLE "cash_bank_layer";

-- DropEnum
DROP TYPE "CashBankLayerStatus";

-- The Posisi Layer Kurs report went with the layers (Claude-ERP.md P37). Its
-- permission is removed from the catalogue in code; the seeder deletes
-- nothing, so an installation seeded before this change drops the row and its
-- role grants here rather than keeping a permission that guards no page.
DELETE FROM "sys_role_permission"
WHERE "permission_id" IN (
  SELECT "id" FROM "sys_permission" WHERE "permission_code" = 'REPORT_CASH_BANK_LAYER_VIEW'
);
DELETE FROM "sys_permission" WHERE "permission_code" = 'REPORT_CASH_BANK_LAYER_VIEW';
