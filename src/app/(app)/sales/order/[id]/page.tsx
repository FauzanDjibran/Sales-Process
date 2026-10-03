import { notFound } from "next/navigation";
import { SalesOrderForm } from "@/components/sales/sales-order-form";
import { SalesOrderDeliveriesCard } from "@/components/sales/sales-order-deliveries";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { salesOrderDeliveries } from "@/lib/erp/delivery-order";
import { getSalesOrder, salesOrderOptions } from "@/lib/erp/sales-order";
import { salesOrderAbilities } from "@/lib/erp/sales-order-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_ORDER_VIEW", "/sales/order");
  const order = await getSalesOrder(Number(id));
  if (!order) notFound();
  const customerOrderId = Number(order.header.customer_order_id);
  const options = await salesOrderOptions({ id: order.id, customerOrderId });
  // What was instructed to the warehouse is the Delivery Order module's to
  // read; this page composes the two (P93), once the order can be shipped.
  const showDeliveries = (order.status === "Open" || order.status === "Closed") && actor.permissions.has("DELIVERY_ORDER_VIEW");
  const deliveries = showDeliveries ? await salesOrderDeliveries(order.id, customerOrderId) : null;
  return (
    <>
      <SalesOrderForm mode="view" order={order} options={options} can={salesOrderAbilities(actor.permissions)} />
      {deliveries && (order.status === "Open" || deliveries.orders.length > 0) && (
        <SalesOrderDeliveriesCard
          salesOrderId={order.id}
          deliveries={deliveries}
          canCreate={actor.permissions.has("DELIVERY_ORDER_CREATE")}
          open={order.status === "Open"}
        />
      )}
      <RecordHistoryCard entityKey="sal_order" rowId={order.id} />
    </>
  );
}
