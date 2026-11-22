import { notFound } from "next/navigation";
import { ProductionReceiptView } from "@/components/inventory/production-receipt-view";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getProductionReceipt } from "@/lib/erp/production-receipt";
import { requireWarehouse } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_RECEIPT_VIEW", "/inventory/production-receipt");
  const receipt = await getProductionReceipt(Number(id));
  if (!receipt) notFound();
  await requireWarehouse(actor, receipt.warehouseId);
  return (
    <>
      <ProductionReceiptView receipt={receipt} canReceive={actor.permissions.has("PRODUCTION_RECEIPT_RECEIVE")} />
      <RecordHistoryCard entityKey="log_production_receipt" rowId={receipt.id} />
    </>
  );
}
