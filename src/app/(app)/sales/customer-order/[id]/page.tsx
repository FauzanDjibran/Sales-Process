import { notFound } from "next/navigation";
import { CustomerOrderForm } from "@/components/sales/customer-order-form";
import { CustomerOrderScheduleCard } from "@/components/sales/customer-order-schedule";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getCustomerOrder, customerOrderOptions } from "@/lib/erp/customer-order";
import { customerOrderAbilities } from "@/lib/erp/customer-order-workflow";
import { customerOrderSchedule } from "@/lib/erp/sales-order";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CUSTOMER_ORDER_VIEW", "/sales/customer-order");
  const [order, options] = await Promise.all([getCustomerOrder(Number(id)), customerOrderOptions()]);
  if (!order) notFound();
  // The schedule is the Sales Order module's to read; this page composes the
  // two (P79), and shows it once the order can carry Sales Orders.
  const showSchedule = order.status !== "Draft" && order.status !== "Submitted" && actor.permissions.has("SALES_ORDER_VIEW");
  const schedule = showSchedule ? await customerOrderSchedule(order.id) : null;
  return (
    <>
      <CustomerOrderForm mode="view" order={order} options={options} can={customerOrderAbilities(actor.permissions)} />
      {schedule && (order.status === "Open" || schedule.orders.length > 0) && (
        <CustomerOrderScheduleCard
          customerOrderId={order.id}
          schedule={schedule}
          canCreate={actor.permissions.has("SALES_ORDER_CREATE")}
          open={order.status === "Open"}
        />
      )}
      <RecordHistoryCard entityKey="sal_customer_order" rowId={order.id} />
    </>
  );
}
