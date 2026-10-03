import { notFound } from "next/navigation";
import { DeliveryOrderForm } from "@/components/sales/delivery-order-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryOrderOptions, getDeliveryOrder } from "@/lib/erp/delivery-order";
import { deliveryOrderAbilities } from "@/lib/erp/delivery-order-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("DELIVERY_ORDER_VIEW", "/sales/delivery-order");
  const order = await getDeliveryOrder(Number(id));
  if (!order) notFound();
  const options = await deliveryOrderOptions({
    id: order.id,
    customerOrderId: Number(order.header.customer_order_id),
    lineIds: order.lines.map((l) => Number(l.sales_order_line_id)),
    warehouseId: order.header.warehouse_id,
  });
  return (
    <>
      <DeliveryOrderForm mode="view" order={order} options={options} can={deliveryOrderAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_delivery_order" rowId={order.id} />
    </>
  );
}
