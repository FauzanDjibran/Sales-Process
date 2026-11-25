import { CreditApplicationList } from "@/components/finance/credit-application-list";
import { requirePermission } from "@/lib/erp/auth";
import { listCreditApplications } from "@/lib/erp/ar-credit-application";
import { creditApplicationAbilities } from "@/lib/erp/ar-credit-application-workflow";

export const dynamic = "force-dynamic";

/** The Penerapan Kredit register (P332). */
export default async function Page() {
  const actor = await requirePermission("SALES_CREDIT_APPLICATION_VIEW", "/finance/invoice/credit-application");
  return <CreditApplicationList rows={await listCreditApplications()} can={creditApplicationAbilities(actor.permissions)} />;
}
