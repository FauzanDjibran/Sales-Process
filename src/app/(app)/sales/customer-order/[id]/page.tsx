import { notFound } from "next/navigation";
import { CustomerOrderForm } from "@/components/sales/customer-order-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getCustomerOrder, customerOrderOptions } from "@/lib/erp/customer-order";
import { customerOrderAbilities } from "@/lib/erp/customer-order-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CUSTOMER_ORDER_VIEW", "/sales/customer-order");
  const [order, options] = await Promise.all([getCustomerOrder(Number(id)), customerOrderOptions()]);
  if (!order) notFound();
  return (
    <>
      <CustomerOrderForm mode="view" order={order} options={options} can={customerOrderAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_customer_order" rowId={order.id} />
    </>
  );
}
