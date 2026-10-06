import { InvoiceForm } from "@/components/finance/invoice-form";
import { requirePermission } from "@/lib/erp/auth";
import { invoiceOptions } from "@/lib/erp/ar-invoice";
import { invoiceAbilities } from "@/lib/erp/ar-invoice-workflow";
import { fakturNsfpByArItemIds } from "@/lib/erp/tax-document";

export const dynamic = "force-dynamic";

/** The faktur uang muka NSFP of every Uang Muka item the form offers (P116). */
function advanceItemIds(options: Awaited<ReturnType<typeof invoiceOptions>>): number[] {
  return options.orders.flatMap((o) => o.advances.map((a) => a.id));
}

/** A new Invoice — with `?co=<id>`, started from that Customer Order's page. */
export default async function Page({ searchParams }: { searchParams: Promise<{ co?: string }> }) {
  const actor = await requirePermission("SALES_INVOICE_CREATE", "/finance/invoice/sales/new");
  const { co } = await searchParams;
  const options = await invoiceOptions();
  return (
    <InvoiceForm
      mode="new"
      invoice={null}
      options={options}
      can={invoiceAbilities(actor.permissions)}
      presetOrderId={Number(co) || null}
      advanceNsfp={await fakturNsfpByArItemIds(advanceItemIds(options))}
    />
  );
}
