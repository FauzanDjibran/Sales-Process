import { SalesReturnForm } from "@/components/sales/sales-return-form";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteBilling } from "@/lib/erp/ar-invoice";
import { salesReturnOptions } from "@/lib/erp/sales-return";
import { salesReturnAbilities } from "@/lib/erp/sales-return-workflow";

export const dynamic = "force-dynamic";

/** A new Sales Return — `?co=<id>` loads that Customer Order's posted deliveries. */
export default async function Page({ searchParams }: { searchParams: Promise<{ co?: string }> }) {
  const actor = await requirePermission("SALES_RETURN_CREATE", "/sales/return/new");
  const co = Number((await searchParams).co) || null;
  const options = await salesReturnOptions(co);
  // Which Invoice billed each line is the invoice module's; this page composes it.
  const billing = await deliveryNoteBilling(options.source?.lines.map((l) => l.id) ?? []);
  return (
    <SalesReturnForm
      key={co ?? 0}
      mode="new"
      ret={null}
      options={options}
      billing={billing}
      can={salesReturnAbilities(actor.permissions)}
    />
  );
}
