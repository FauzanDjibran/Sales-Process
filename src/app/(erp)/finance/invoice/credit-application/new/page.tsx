import { CreditApplicationForm } from "@/components/finance/credit-application-form";
import { requirePermission } from "@/lib/erp/auth";
import { creditApplicationOptions } from "@/lib/erp/ar-credit-application";
import { creditApplicationAbilities } from "@/lib/erp/ar-credit-application-workflow";
import { draftRefundsByCreditNotes } from "@/lib/erp/cash-payment";

export const dynamic = "force-dynamic";

/** A new Penerapan Kredit: open customer credit and the open Invoices it may lower (P332). */
export default async function Page() {
  const actor = await requirePermission("SALES_CREDIT_APPLICATION_CREATE", "/finance/invoice/credit-application/new");
  const options = await creditApplicationOptions(null, draftRefundsByCreditNotes);
  return <CreditApplicationForm mode="new" application={null} options={options} can={creditApplicationAbilities(actor.permissions)} />;
}
