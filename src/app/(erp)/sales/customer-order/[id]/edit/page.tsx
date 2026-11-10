import { notFound, redirect } from "next/navigation";
import { CustomerOrderForm } from "@/components/sales/customer-order-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getCustomerOrder, customerOrderOptions } from "@/lib/erp/customer-order";
import { customerOrderAbilities, customerOrderIsEditable } from "@/lib/erp/customer-order-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CUSTOMER_ORDER_EDIT", `/sales/customer-order/${id}/edit`);
  const [order, options] = await Promise.all([getCustomerOrder(Number(id)), customerOrderOptions()]);
  if (!order) notFound();
  if (!customerOrderIsEditable(order.status)) redirect(`/sales/customer-order/${order.id}`);
  return (
    <>
      <CustomerOrderForm mode="edit" order={order} options={options} can={customerOrderAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_customer_order" rowId={order.id} />
    </>
  );
}
