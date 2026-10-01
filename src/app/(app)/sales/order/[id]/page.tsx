import { notFound } from "next/navigation";
import { SalesOrderForm } from "@/components/sales/sales-order-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getSalesOrder, salesOrderOptions } from "@/lib/erp/sales-order";
import { salesOrderAbilities } from "@/lib/erp/sales-order-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_ORDER_VIEW", "/sales/order");
  const order = await getSalesOrder(Number(id));
  if (!order) notFound();
  const options = await salesOrderOptions({ id: order.id, customerOrderId: Number(order.header.customer_order_id) });
  return (
    <>
      <SalesOrderForm mode="view" order={order} options={options} can={salesOrderAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_order" rowId={order.id} />
    </>
  );
}
