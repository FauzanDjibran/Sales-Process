import { notFound } from "next/navigation";
import { StockTransferForm } from "@/components/inventory/stock-transfer-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getStockTransfer, stockTransferCurrent, stockTransferOptions } from "@/lib/erp/stock-transfer";
import { receiptsOfTransfer } from "@/lib/erp/stock-transfer-receipt";
import { stockTransferAbilities } from "@/lib/erp/stock-transfer-workflow";
import { requireWarehouse, warehouseAllowed, warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_TRANSFER_VIEW", "/inventory/stock-transfer");
  const transfer = await getStockTransfer(Number(id));
  if (!transfer) notFound();
  const fromId = Number(transfer.header.from_warehouse_id);
  const toId = Number(transfer.header.to_warehouse_id);
  // The sender and the receiver both see it (OD-9).
  await requireWarehouse(actor, fromId, toId);
  const scope = await warehouseIdsOf(actor);
  const [options, receipts] = await Promise.all([stockTransferOptions(scope, stockTransferCurrent(transfer)), receiptsOfTransfer(transfer.id)]);
  // Only the origin's people act on the Kirim; the destination's receive it.
  const can = warehouseAllowed(scope, fromId) ? stockTransferAbilities(actor.permissions) : { create: false, edit: false, send: false, cancel: false };
  return (
    <>
      <StockTransferForm
        mode="view"
        transfer={transfer}
        options={options}
        can={can}
        receipts={receipts}
      />
      <RecordHistoryCard entityKey="log_stock_transfer" rowId={transfer.id} />
    </>
  );
}
