import { notFound } from "next/navigation";
import { PermitInvoiceForm } from "@/components/finance/permit-invoice-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPermitInvoice, permitInvoiceOptions } from "@/lib/erp/permit-invoice";
import { permitInvoiceAbilities } from "@/lib/erp/ar-invoice-workflow";
import { settlementsOfDocument } from "@/lib/erp/cash-bank-tx";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PERMIT_INVOICE_VIEW", "/finance/invoice/permit");
  const invoice = await getPermitInvoice(Number(id));
  if (!invoice) notFound();
  const [options, payments] = await Promise.all([
    permitInvoiceOptions({ id: invoice.id, requestId: Number(invoice.input.permit_request_id), itemIds: invoice.deductions.map((d) => d.ar_item_id) }),
    settlementsOfDocument("fin_ar_permit_invoice", invoice.id),
  ]);
  return (
    <>
      <PermitInvoiceForm mode="view" invoice={invoice} options={options} can={permitInvoiceAbilities(actor.permissions)} payments={payments} />
      <RecordHistoryCard entityKey="fin_ar_permit_invoice" rowId={invoice.id} />
    </>
  );
}
