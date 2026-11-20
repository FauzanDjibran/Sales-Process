import { StockTransferList } from "@/components/inventory/stock-transfer-list";
import { requirePermission } from "@/lib/erp/auth";
import { listStockTransfers } from "@/lib/erp/stock-transfer";
import { stockTransferAbilities } from "@/lib/erp/stock-transfer-workflow";
import { warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** The Transfer Kirim register (P300): what leaves or reaches the user's warehouses (OD-9). */
export default async function Page() {
  const actor = await requirePermission("STOCK_TRANSFER_VIEW", "/inventory/stock-transfer");
  const transfers = await listStockTransfers(await warehouseIdsOf(actor));
  return <StockTransferList transfers={transfers} canCreate={stockTransferAbilities(actor.permissions).create} />;
}
