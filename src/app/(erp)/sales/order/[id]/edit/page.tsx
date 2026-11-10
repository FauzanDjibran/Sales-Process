import { notFound, redirect } from "next/navigation";
import { SalesOrderForm } from "@/components/sales/sales-order-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getSalesOrder, salesOrderOptions } from "@/lib/erp/sales-order";
import { salesOrderAbilities, salesOrderIsEditable } from "@/lib/erp/sales-order-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_ORDER_EDIT", `/sales/order/${id}/edit`);
  const order = await getSalesOrder(Number(id));
  if (!order) notFound();
  if (!salesOrderIsEditable(order.status)) redirect(`/sales/order/${order.id}`);
  const options = await salesOrderOptions({ id: order.id, customerOrderId: Number(order.header.customer_order_id) });
  return (
    <>
      <SalesOrderForm mode="edit" order={order} options={options} can={salesOrderAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_order" rowId={order.id} />
    </>
  );
}
