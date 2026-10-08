import { PermitInvoiceForm } from "@/components/finance/permit-invoice-form";
import { requirePermission } from "@/lib/erp/auth";
import { permitInvoiceOptions } from "@/lib/erp/permit-invoice";
import { permitInvoiceAbilities } from "@/lib/erp/ar-invoice-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PERMIT_INVOICE_CREATE", "/finance/invoice/permit/new");
  return <PermitInvoiceForm mode="new" invoice={null} options={await permitInvoiceOptions()} can={permitInvoiceAbilities(actor.permissions)} />;
}
