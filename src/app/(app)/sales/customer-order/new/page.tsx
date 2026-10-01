import { CustomerOrderForm } from "@/components/sales/customer-order-form";
import { requirePermission } from "@/lib/erp/auth";
import { getCustomerOrder, customerOrderOptions } from "@/lib/erp/customer-order";
import { customerOrderAbilities } from "@/lib/erp/customer-order-workflow";

export const dynamic = "force-dynamic";

/**
 * A new Customer Order — or, with `?from=<id>`, a Salin of one: a Draft with the
 * same customer and lines, dated today, without the customer's PO.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const actor = await requirePermission("CUSTOMER_ORDER_CREATE", "/sales/customer-order/new");
  const { from } = await searchParams;
  const [options, copyFrom] = await Promise.all([
    customerOrderOptions(),
    from ? getCustomerOrder(Number(from)) : Promise.resolve(null),
  ]);
  return (
    <CustomerOrderForm
      mode="new"
      order={null}
      copyFrom={copyFrom}
      options={options}
      can={customerOrderAbilities(actor.permissions)}
    />
  );
}
