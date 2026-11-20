import { TransferReceiptList } from "@/components/inventory/stock-transfer-list";
import { requirePermission } from "@/lib/erp/auth";
import { listTransferReceipts } from "@/lib/erp/stock-transfer-receipt";
import { stockTransferReceiptAbilities } from "@/lib/erp/stock-transfer-workflow";
import { warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** The Transfer Terima register (P300): what came into the user's warehouses (OD-9). */
export default async function Page() {
  const actor = await requirePermission("STOCK_TRANSFER_RECEIPT_VIEW", "/inventory/stock-transfer-receipt");
  const receipts = await listTransferReceipts(await warehouseIdsOf(actor));
  return <TransferReceiptList receipts={receipts} canCreate={stockTransferReceiptAbilities(actor.permissions).create} />;
}
