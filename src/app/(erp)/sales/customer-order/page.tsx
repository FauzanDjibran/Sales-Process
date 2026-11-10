import { CustomerOrderList } from "@/components/sales/customer-order-list";
import { requirePermission } from "@/lib/erp/auth";
import { listCustomerOrders } from "@/lib/erp/customer-order";
import { customerOrderAbilities } from "@/lib/erp/customer-order-workflow";

export const dynamic = "force-dynamic";

/** The Customer Order register (P49). */
export default async function Page() {
  const actor = await requirePermission("CUSTOMER_ORDER_VIEW", "/sales/customer-order");
  return <CustomerOrderList orders={await listCustomerOrders()} can={customerOrderAbilities(actor.permissions)} />;
}
