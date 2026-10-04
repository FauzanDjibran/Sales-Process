import { InvoiceForm } from "@/components/sales/invoice-form";
import { requirePermission } from "@/lib/erp/auth";
import { invoiceOptions } from "@/lib/erp/sales-invoice";
import { invoiceAbilities } from "@/lib/erp/sales-invoice-workflow";

export const dynamic = "force-dynamic";

/** A new Faktur — with `?co=<id>`, started from that Customer Order's page. */
export default async function Page({ searchParams }: { searchParams: Promise<{ co?: string }> }) {
  const actor = await requirePermission("SALES_INVOICE_CREATE", "/sales/invoice/new");
  const { co } = await searchParams;
  return (
    <InvoiceForm
      mode="new"
      invoice={null}
      options={await invoiceOptions()}
      can={invoiceAbilities(actor.permissions)}
      presetOrderId={Number(co) || null}
    />
  );
}
