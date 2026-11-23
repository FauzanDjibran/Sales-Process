import { notFound } from "next/navigation";
import { StockReceiptView } from "@/components/inventory/stock-receipt-view";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getStockReceipt } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH } from "@/lib/erp/stock-receipt-purposes";
import { requireWarehouse } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_RECEIPT_VIEW", STOCK_RECEIPT_PATH);
  const receipt = await getStockReceipt(Number(id));
  if (!receipt) notFound();
  await requireWarehouse(actor, receipt.warehouseId);
  return (
    <>
      <StockReceiptView receipt={receipt} canReceive={actor.permissions.has("STOCK_RECEIPT_RECEIVE")} />
      <RecordHistoryCard entityKey="log_stock_receipt" rowId={receipt.id} />
    </>
  );
}
