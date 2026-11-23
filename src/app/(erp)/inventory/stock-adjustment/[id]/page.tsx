import { notFound } from "next/navigation";
import { StockAdjustmentForm } from "@/components/inventory/stock-adjustment-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getStockAdjustment, stockAdjustmentOptions } from "@/lib/erp/stock-adjustment";
import { stockAdjustmentAbilities } from "@/lib/erp/stock-adjustment-workflow";
import { requireWarehouse, warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_ADJUSTMENT_VIEW", `/inventory/stock-adjustment/${id}`);
  const doc = await getStockAdjustment(Number(id));
  if (!doc) notFound();
  await requireWarehouse(actor, doc.warehouse.id);
  const options = await stockAdjustmentOptions(await warehouseIdsOf(actor), doc.warehouse.id);
  return (
    <>
      <StockAdjustmentForm mode="view" doc={doc} sheet={null} options={options} can={stockAdjustmentAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_stock_adjustment" rowId={doc.id} />
    </>
  );
}
