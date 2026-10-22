import { notFound } from "next/navigation";
import { ProductionOrderForm } from "@/components/production/production-order-form";
import { ProductionOrderIssuesCard } from "@/components/production/production-order-issues";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getProductionOrder, productionOrderCurrent, productionOrderOptions } from "@/lib/erp/production-order";
import { productionOrderAbilities } from "@/lib/erp/production-order-workflow";
import { stockIssuesOfOrder } from "@/lib/erp/stock-issue";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_ORDER_VIEW", "/production/order");
  const order = await getProductionOrder(Number(id));
  if (!order) notFound();
  // The BSTBs are the BSTB module's: composed here, never read by the Perintah (§3.1).
  const [options, issued] = await Promise.all([productionOrderOptions(productionOrderCurrent(order)), stockIssuesOfOrder(order.id)]);
  const opened = order.status === "Open" || order.status === "Closed";
  return (
    <>
      <ProductionOrderForm mode="view" order={order} options={options} sent={Object.fromEntries(issued.sent)} can={productionOrderAbilities(actor.permissions)} />
      {opened && <ProductionOrderIssuesCard issues={issued.issues} canCreate={order.status === "Open" && actor.permissions.has("STOCK_ISSUE_CREATE")} />}
      <RecordHistoryCard entityKey="prd_order" rowId={order.id} />
    </>
  );
}
