import { notFound, redirect } from "next/navigation";
import { StockReceiptForm } from "@/components/inventory/stock-receipt-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getStockReceipt, sourceOf, stockReceiptFormOptions } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH } from "@/lib/erp/stock-receipt-purposes";
import { stockReceiptAbilities, stockReceiptIsEditable } from "@/lib/erp/stock-receipt-workflow";
import { requireWarehouse, warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_RECEIPT_EDIT", `${STOCK_RECEIPT_PATH}/${id}/edit`);
  const receipt = await getStockReceipt(Number(id));
  if (!receipt) notFound();
  await requireWarehouse(actor, receipt.warehouseId);
  if (!stockReceiptIsEditable(receipt.status)) redirect(`${STOCK_RECEIPT_PATH}/${receipt.id}`);
  const [options, source] = await Promise.all([
    stockReceiptFormOptions(await warehouseIdsOf(actor), { warehouseId: receipt.warehouseId, itemIds: receipt.rows.map((r) => r.itemId) }),
    receipt.sourceKey ? sourceOf(receipt.purpose, receipt.sourceKey) : null,
  ]);
  return (
    <>
      <StockReceiptForm mode="edit" receipt={receipt} purpose={receipt.purpose} source={source} options={options} can={stockReceiptAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_stock_receipt" rowId={receipt.id} />
    </>
  );
}
