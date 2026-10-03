import { notFound } from "next/navigation";
import { DeliveryOrderForm } from "@/components/sales/delivery-order-form";
import { DeliveryOrderNotesCard } from "@/components/sales/delivery-order-notes";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryOrderNotes } from "@/lib/erp/delivery-note";
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
  // What has left is the Delivery Note module's to read; this page composes
  // the two once the order can be shipped.
  const showNotes = (order.status === "Issued" || order.status === "Closed") && actor.permissions.has("DELIVERY_NOTE_VIEW");
  const notes = showNotes ? await deliveryOrderNotes(order.id) : null;
  return (
    <>
      <DeliveryOrderForm mode="view" order={order} options={options} can={deliveryOrderAbilities(actor.permissions)} />
      {notes && (order.status === "Issued" || notes.notes.length > 0) && (
        <DeliveryOrderNotesCard
          deliveryOrderId={order.id}
          deliveries={notes}
          canCreate={actor.permissions.has("DELIVERY_NOTE_CREATE")}
          open={order.status === "Issued"}
        />
      )}
      <RecordHistoryCard entityKey="sal_delivery_order" rowId={order.id} />
    </>
  );
}
