import { notFound, redirect } from "next/navigation";
import { InvoiceForm } from "@/components/finance/invoice-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getInvoice, invoiceOptions } from "@/lib/erp/ar-invoice";
import { invoiceAbilities, invoiceIsEditable } from "@/lib/erp/ar-invoice-workflow";
import { fakturNsfpByArItemIds } from "@/lib/erp/tax-document";

export const dynamic = "force-dynamic";

/** The faktur uang muka NSFP of every Uang Muka item the form offers (P116). */
function advanceItemIds(options: Awaited<ReturnType<typeof invoiceOptions>>): number[] {
  return options.orders.flatMap((o) => o.advances.map((a) => a.id));
}

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_INVOICE_EDIT", `/finance/invoice/sales/${id}/edit`);
  const invoice = await getInvoice(Number(id));
  if (!invoice) notFound();
  if (!invoiceIsEditable(invoice.status)) redirect(`/finance/invoice/sales/${invoice.id}`);
  const options = await invoiceOptions({
    id: invoice.id,
    orderId: Number(invoice.header.customer_order_id),
    lineIds: invoice.lines.map((l) => Number(l.delivery_note_line_id)),
    itemIds: invoice.deductions.map((d) => d.ar_item_id),
  });
  return (
    <>
      <InvoiceForm
        mode="edit"
        invoice={invoice}
        options={options}
        can={invoiceAbilities(actor.permissions)}
        advanceNsfp={await fakturNsfpByArItemIds(advanceItemIds(options))}
      />
      <RecordHistoryCard entityKey="fin_ar_invoice" rowId={invoice.id} />
    </>
  );
}
