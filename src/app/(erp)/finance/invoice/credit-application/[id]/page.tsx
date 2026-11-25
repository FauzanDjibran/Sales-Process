import { notFound } from "next/navigation";
import { CreditApplicationForm } from "@/components/finance/credit-application-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { creditApplicationOptions, getCreditApplication } from "@/lib/erp/ar-credit-application";
import { creditApplicationAbilities } from "@/lib/erp/ar-credit-application-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_CREDIT_APPLICATION_VIEW", "/finance/invoice/credit-application");
  const application = await getCreditApplication(Number(id));
  if (!application) notFound();
  const options = await creditApplicationOptions(application);
  return (
    <>
      <CreditApplicationForm mode="view" application={application} options={options} can={creditApplicationAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_ar_credit_application" rowId={application.id} />
    </>
  );
}
