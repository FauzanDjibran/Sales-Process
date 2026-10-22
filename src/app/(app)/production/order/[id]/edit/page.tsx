import { notFound, redirect } from "next/navigation";
import { ProductionOrderForm } from "@/components/production/production-order-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getProductionOrder, productionOrderCurrent, productionOrderOptions } from "@/lib/erp/production-order";
import { productionOrderAbilities, productionOrderIsEditable } from "@/lib/erp/production-order-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_ORDER_EDIT", `/production/order/${id}/edit`);
  const order = await getProductionOrder(Number(id));
  if (!order) notFound();
  if (!productionOrderIsEditable(order.status)) redirect(`/production/order/${order.id}`);
  const options = await productionOrderOptions(productionOrderCurrent(order));
  return (
    <>
      <ProductionOrderForm mode="edit" order={order} options={options} sent={{}} can={productionOrderAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_order" rowId={order.id} />
    </>
  );
}
