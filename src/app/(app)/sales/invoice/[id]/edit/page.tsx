import { notFound, redirect } from "next/navigation";
import { InvoiceForm } from "@/components/sales/invoice-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getInvoice, invoiceOptions } from "@/lib/erp/sales-invoice";
import { invoiceAbilities, invoiceIsEditable } from "@/lib/erp/sales-invoice-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_INVOICE_EDIT", `/sales/invoice/${id}/edit`);
  const invoice = await getInvoice(Number(id));
  if (!invoice) notFound();
  if (!invoiceIsEditable(invoice.status)) redirect(`/sales/invoice/${invoice.id}`);
  const options = await invoiceOptions({
    id: invoice.id,
    orderId: Number(invoice.header.customer_order_id),
    lineIds: invoice.lines.map((l) => Number(l.delivery_note_line_id)),
    itemIds: invoice.deductions.map((d) => d.ar_item_id),
  });
  return (
    <>
      <InvoiceForm mode="edit" invoice={invoice} options={options} can={invoiceAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_invoice" rowId={invoice.id} />
    </>
  );
}
