import { PermitInvoiceList } from "@/components/finance/permit-invoice-list";
import { requirePermission } from "@/lib/erp/auth";
import { listPermitInvoices } from "@/lib/erp/permit-invoice";
import { permitInvoiceAbilities } from "@/lib/erp/ar-invoice-workflow";

export const dynamic = "force-dynamic";

/** The Invoice Perizinan register (P137). */
export default async function Page() {
  const actor = await requirePermission("PERMIT_INVOICE_VIEW", "/finance/invoice/permit");
  return <PermitInvoiceList rows={await listPermitInvoices()} can={permitInvoiceAbilities(actor.permissions)} />;
}
