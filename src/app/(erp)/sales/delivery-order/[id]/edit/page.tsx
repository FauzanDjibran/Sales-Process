import { notFound, redirect } from "next/navigation";
import { DeliveryOrderForm } from "@/components/sales/delivery-order-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryOrderOptions, getDeliveryOrder } from "@/lib/erp/delivery-order";
import { deliveryOrderAbilities, deliveryOrderIsEditable } from "@/lib/erp/delivery-order-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("DELIVERY_ORDER_EDIT", `/sales/delivery-order/${id}/edit`);
  const order = await getDeliveryOrder(Number(id));
  if (!order) notFound();
  if (!deliveryOrderIsEditable(order.status)) redirect(`/sales/delivery-order/${order.id}`);
  const options = await deliveryOrderOptions({
    id: order.id,
    customerOrderId: Number(order.header.customer_order_id),
    lineIds: order.lines.map((l) => Number(l.sales_order_line_id)),
    warehouseId: order.header.warehouse_id,
  });
  return (
    <>
      <DeliveryOrderForm mode="edit" order={order} options={options} can={deliveryOrderAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_delivery_order" rowId={order.id} />
    </>
  );
}
