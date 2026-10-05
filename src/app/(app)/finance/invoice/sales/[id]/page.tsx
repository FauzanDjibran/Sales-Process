import { notFound } from "next/navigation";
import { InvoiceForm } from "@/components/finance/invoice-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getInvoice, invoiceOptions, invoicePayStates } from "@/lib/erp/ar-invoice";
import { settlementsOfDocument } from "@/lib/erp/cash-bank-tx";
import { invoiceAbilities } from "@/lib/erp/ar-invoice-workflow";
import { taxDocsOf } from "@/lib/erp/tax-document";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_INVOICE_VIEW", "/finance/invoice/sales");
  const invoice = await getInvoice(Number(id));
  if (!invoice) notFound();
  const can = invoiceAbilities(actor.permissions);
  // The journal Posting would write is not read here: the Posting dialog asks
  // for it as a dry run when it opens (P103).
  const [options, pay, payments, taxDocs] = await Promise.all([
    invoiceOptions({
      id: invoice.id,
      orderId: Number(invoice.header.customer_order_id),
      lineIds: invoice.lines.map((l) => Number(l.delivery_note_line_id)),
      itemIds: invoice.deductions.map((d) => d.ar_item_id),
    }),
    // Where it stands, and the receipts that paid it — composed here (U26).
    invoice.status === "Posted" ? invoicePayStates([invoice.id]).then((m) => m[invoice.id] ?? null) : Promise.resolve(null),
    invoice.status === "Posted" ? settlementsOfDocument("fin_ar_invoice", invoice.id) : Promise.resolve([]),
    // Its faktur pajak and the bukti potong of its payments (P100).
    invoice.status === "Posted" ? taxDocsOf("fin_ar_invoice", invoice.id) : Promise.resolve(null),
  ]);
  return (
    <>
      <InvoiceForm mode="view" invoice={invoice} options={options} can={can} pay={pay} payments={payments} taxDocs={taxDocs} />
      <RecordHistoryCard entityKey="fin_ar_invoice" rowId={invoice.id} />
    </>
  );
}
