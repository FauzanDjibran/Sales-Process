import { notFound, redirect } from "next/navigation";
import { PurchaseInvoiceForm } from "@/components/finance/purchase-invoice-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPurchaseInvoice, purchaseInvoiceOptions } from "@/lib/erp/ap-invoice";
import { invoiceIsEditable, purchaseInvoiceAbilities } from "@/lib/erp/ap-invoice-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PURCHASE_INVOICE_EDIT", `/finance/invoice/purchase/${id}/edit`);
  const invoice = await getPurchaseInvoice(Number(id));
  if (!invoice) notFound();
  if (!invoiceIsEditable(invoice.status)) redirect(`/finance/invoice/purchase/${invoice.id}`);
  const options = await purchaseInvoiceOptions({
    id: invoice.id,
    orderId: Number(invoice.header.purchase_order_id),
    lineIds: invoice.lines.map((l) => Number(l.receipt_note_line_id)),
    itemIds: invoice.deductions.map((d) => d.ap_item_id),
  });
  return (
    <>
      <PurchaseInvoiceForm mode="edit" invoice={invoice} options={options} can={purchaseInvoiceAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_ap_invoice" rowId={invoice.id} />
    </>
  );
}
