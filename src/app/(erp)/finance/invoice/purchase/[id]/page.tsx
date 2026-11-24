import { notFound } from "next/navigation";
import { PurchaseInvoiceForm } from "@/components/finance/purchase-invoice-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPurchaseInvoice, purchaseInvoiceOptions, purchaseInvoicePayStates } from "@/lib/erp/ap-invoice";
import { settlementsOfDocument } from "@/lib/erp/cash-bank-tx";
import { purchaseInvoiceAbilities } from "@/lib/erp/ap-invoice-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PURCHASE_INVOICE_VIEW", "/finance/invoice/purchase");
  const invoice = await getPurchaseInvoice(Number(id));
  if (!invoice) notFound();
  const posted = invoice.status === "Posted";
  // Where it stands and the payments that paid it: composed here, as the sales Invoice's page does.
  const [options, pay, payments] = await Promise.all([
    purchaseInvoiceOptions({
      id: invoice.id,
      orderId: Number(invoice.header.purchase_order_id),
      lineIds: invoice.lines.map((l) => Number(l.receipt_note_line_id)),
      itemIds: invoice.deductions.map((d) => d.ap_item_id),
    }),
    posted ? purchaseInvoicePayStates([invoice.id]).then((m) => m[invoice.id] ?? null) : null,
    posted ? settlementsOfDocument("fin_ap_invoice", invoice.id) : [],
  ]);
  return (
    <>
      <PurchaseInvoiceForm mode="view" invoice={invoice} options={options} can={purchaseInvoiceAbilities(actor.permissions)} pay={pay} payments={payments} />
      <RecordHistoryCard entityKey="fin_ap_invoice" rowId={invoice.id} />
    </>
  );
}
