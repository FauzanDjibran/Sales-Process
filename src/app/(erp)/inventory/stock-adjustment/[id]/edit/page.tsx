import { notFound, redirect } from "next/navigation";
import { StockAdjustmentForm } from "@/components/inventory/stock-adjustment-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { countSheet, getStockAdjustment, stockAdjustmentOptions } from "@/lib/erp/stock-adjustment";
import { stockAdjustmentAbilities, stockAdjustmentIsEditable } from "@/lib/erp/stock-adjustment-workflow";
import { requireWarehouse, warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_ADJUSTMENT_EDIT", `/inventory/stock-adjustment/${id}/edit`);
  const doc = await getStockAdjustment(Number(id));
  if (!doc) notFound();
  await requireWarehouse(actor, doc.warehouse.id);
  if (!stockAdjustmentIsEditable(doc.status)) redirect(`/inventory/stock-adjustment/${doc.id}`);
  const options = await stockAdjustmentOptions(await warehouseIdsOf(actor), doc.warehouse.id);
  return (
    <>
      <StockAdjustmentForm mode="edit" doc={doc} sheet={await countSheet(doc.warehouse.id)} options={options} can={stockAdjustmentAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_stock_adjustment" rowId={doc.id} />
    </>
  );
}
