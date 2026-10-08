import { notFound, redirect } from "next/navigation";
import { PermitRequestForm } from "@/components/sales/permit-request-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPermitRequest, permitRequestOptions } from "@/lib/erp/permit-request";
import { permitRequestAbilities, permitRequestIsEditable } from "@/lib/erp/permit-request-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PERMIT_REQUEST_EDIT", `/sales/permit/${id}/edit`);
  const [request, options] = await Promise.all([getPermitRequest(Number(id)), permitRequestOptions()]);
  if (!request) notFound();
  if (!permitRequestIsEditable(request.status)) redirect(`/sales/permit/${request.id}`);
  return (
    <>
      <PermitRequestForm mode="edit" request={request} options={options} can={permitRequestAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_permit_request" rowId={request.id} />
    </>
  );
}
