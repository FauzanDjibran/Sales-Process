import { SalesOrderForm } from "@/components/sales/sales-order-form";
import { requirePermission } from "@/lib/erp/auth";
import { getSalesOrder, salesOrderOptions } from "@/lib/erp/sales-order";
import { salesOrderAbilities } from "@/lib/erp/sales-order-workflow";

export const dynamic = "force-dynamic";

/**
 * A new Sales Order — or, with `?from=<id>`, a Salin of one: a Draft with the
 * same customer and lines, dated today, without the customer's PO.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const actor = await requirePermission("SALES_ORDER_CREATE", "/sales/order/new");
  const { from } = await searchParams;
  const [options, copyFrom] = await Promise.all([
    salesOrderOptions(),
    from ? getSalesOrder(Number(from)) : Promise.resolve(null),
  ]);
  return (
    <SalesOrderForm
      mode="new"
      order={null}
      copyFrom={copyFrom}
      options={options}
      can={salesOrderAbilities(actor.permissions)}
    />
  );
}
