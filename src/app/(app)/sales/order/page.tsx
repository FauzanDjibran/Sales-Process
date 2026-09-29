import { SalesOrderList } from "@/components/sales/sales-order-list";
import { requirePermission } from "@/lib/erp/auth";
import { listSalesOrders } from "@/lib/erp/sales-order";
import { salesOrderAbilities } from "@/lib/erp/sales-order-workflow";

export const dynamic = "force-dynamic";

/** The Sales Order register (P49). */
export default async function Page() {
  const actor = await requirePermission("SALES_ORDER_VIEW", "/sales/order");
  return <SalesOrderList orders={await listSalesOrders()} can={salesOrderAbilities(actor.permissions)} />;
}
