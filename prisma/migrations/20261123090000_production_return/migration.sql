-- P304: BSTB Pengeluaran (Simulasi-Gudang-Produksi-Plan.md 7.6), purpose `return` of
-- log_production_receipt. At Terima the warehouse takes the goods at their
-- value or at 0, the latter charging Beban Pemusnahan Produksi.

-- AlterTable
ALTER TABLE "log_production_receipt" ADD COLUMN     "value_mode" TEXT,
ADD COLUMN     "written_off_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;


ALTER TABLE "log_production_receipt" ADD CONSTRAINT "log_production_receipt_value_mode" CHECK ("value_mode" IS NULL OR "value_mode" IN ('carried', 'none'));
ALTER TABLE "log_production_receipt" ADD CONSTRAINT "log_production_receipt_written_off" CHECK ("written_off_amount" >= 0 AND "written_off_amount" <= "cost_amount");

-- The one Kirim permission now sends either kind.
UPDATE "sys_permission" SET "permission_name" = 'Kirim BSTB ke Gudang', "updated_at" = now() WHERE "permission_code" = 'PRODUCTION_RECEIPT_SEND';
