import { notFound, redirect } from "next/navigation";
import { CreditApplicationForm } from "@/components/finance/credit-application-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { creditApplicationOptions, getCreditApplication } from "@/lib/erp/ar-credit-application";
import { creditApplicationAbilities, creditApplicationIsEditable } from "@/lib/erp/ar-credit-application-workflow";
import { draftRefundsByCreditNotes } from "@/lib/erp/cash-payment";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_CREDIT_APPLICATION_EDIT", `/finance/invoice/credit-application/${id}/edit`);
  const application = await getCreditApplication(Number(id));
  if (!application) notFound();
  if (!creditApplicationIsEditable(application.status)) redirect(`/finance/invoice/credit-application/${application.id}`);
  const options = await creditApplicationOptions(application, draftRefundsByCreditNotes);
  return (
    <>
      <CreditApplicationForm mode="edit" application={application} options={options} can={creditApplicationAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_ar_credit_application" rowId={application.id} />
    </>
  );
}
