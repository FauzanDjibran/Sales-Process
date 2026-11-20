import { notFound, redirect } from "next/navigation";
import { StockTransferForm } from "@/components/inventory/stock-transfer-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getStockTransfer, stockTransferCurrent, stockTransferOptions } from "@/lib/erp/stock-transfer";
import { stockTransferAbilities, stockTransferIsEditable } from "@/lib/erp/stock-transfer-workflow";
import { requireWarehouse, warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** Only a Draft is edited, by the origin's people; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_TRANSFER_EDIT", `/inventory/stock-transfer/${id}/edit`);
  const transfer = await getStockTransfer(Number(id));
  if (!transfer) notFound();
  await requireWarehouse(actor, Number(transfer.header.from_warehouse_id));
  if (!stockTransferIsEditable(transfer.status)) redirect(`/inventory/stock-transfer/${transfer.id}`);
  const options = await stockTransferOptions(await warehouseIdsOf(actor), stockTransferCurrent(transfer));
  return (
    <>
      <StockTransferForm mode="edit" transfer={transfer} options={options} can={stockTransferAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_stock_transfer" rowId={transfer.id} />
    </>
  );
}
