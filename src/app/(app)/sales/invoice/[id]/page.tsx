import { notFound } from "next/navigation";
import { InvoiceForm } from "@/components/sales/invoice-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getInvoice, invoiceOptions, invoicePreview } from "@/lib/erp/sales-invoice";
import { invoiceAbilities } from "@/lib/erp/sales-invoice-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_INVOICE_VIEW", "/sales/invoice");
  const invoice = await getInvoice(Number(id));
  if (!invoice) notFound();
  const can = invoiceAbilities(actor.permissions);
  const [options, preview] = await Promise.all([
    invoiceOptions({
      id: invoice.id,
      orderId: Number(invoice.header.customer_order_id),
      lineIds: invoice.lines.map((l) => Number(l.delivery_note_line_id)),
      itemIds: invoice.deductions.map((d) => d.ar_item_id),
    }),
    // The journal Posting would write, for its confirmation — only for a Draft this user may post.
    invoice.status === "Draft" && can.post ? invoicePreview(invoice.id) : Promise.resolve(null),
  ]);
  return (
    <>
      <InvoiceForm mode="view" invoice={invoice} options={options} can={can} preview={preview} />
      <RecordHistoryCard entityKey="sal_invoice" rowId={invoice.id} />
    </>
  );
}
