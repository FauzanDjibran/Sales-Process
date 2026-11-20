import { StockTransferForm } from "@/components/inventory/stock-transfer-form";
import { requirePermission } from "@/lib/erp/auth";
import { stockTransferOptions } from "@/lib/erp/stock-transfer";
import { stockTransferAbilities } from "@/lib/erp/stock-transfer-workflow";
import { warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** A new Transfer Kirim (P300), from one of the user's warehouses. */
export default async function Page() {
  const actor = await requirePermission("STOCK_TRANSFER_CREATE", "/inventory/stock-transfer/new");
  const options = await stockTransferOptions(await warehouseIdsOf(actor));
  return <StockTransferForm mode="new" transfer={null} options={options} can={stockTransferAbilities(actor.permissions)} />;
}
