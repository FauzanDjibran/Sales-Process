import { SalesOrderForm } from "@/components/sales/sales-order-form";
import { requirePermission } from "@/lib/erp/auth";
import { salesOrderOptions } from "@/lib/erp/sales-order";
import { salesOrderAbilities } from "@/lib/erp/sales-order-workflow";

export const dynamic = "force-dynamic";

/** A new Sales Order — with `?co=<id>`, started from that Customer Order's page. */
export default async function Page({ searchParams }: { searchParams: Promise<{ co?: string }> }) {
  const actor = await requirePermission("SALES_ORDER_CREATE", "/sales/order/new");
  const { co } = await searchParams;
  return (
    <SalesOrderForm
      mode="new"
      order={null}
      options={await salesOrderOptions()}
      can={salesOrderAbilities(actor.permissions)}
      presetCustomerOrderId={Number(co) || null}
    />
  );
}
