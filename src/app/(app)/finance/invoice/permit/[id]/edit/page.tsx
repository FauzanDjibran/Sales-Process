import { notFound, redirect } from "next/navigation";
import { PermitInvoiceForm } from "@/components/finance/permit-invoice-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPermitInvoice, permitInvoiceOptions } from "@/lib/erp/permit-invoice";
import { invoiceIsEditable, permitInvoiceAbilities } from "@/lib/erp/ar-invoice-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PERMIT_INVOICE_EDIT", `/finance/invoice/permit/${id}/edit`);
  const invoice = await getPermitInvoice(Number(id));
  if (!invoice) notFound();
  if (!invoiceIsEditable(invoice.status)) redirect(`/finance/invoice/permit/${invoice.id}`);
  const options = await permitInvoiceOptions({ id: invoice.id, requestId: Number(invoice.input.permit_request_id), itemIds: invoice.deductions.map((d) => d.ar_item_id) });
  return (
    <>
      <PermitInvoiceForm mode="edit" invoice={invoice} options={options} can={permitInvoiceAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_ar_permit_invoice" rowId={invoice.id} />
    </>
  );
}
