import { notFound } from "next/navigation";
import { PermitRequestForm } from "@/components/sales/permit-request-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPermitRequest, permitRequestOptions } from "@/lib/erp/permit-request";
import { permitRequestAbilities } from "@/lib/erp/permit-request-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PERMIT_REQUEST_VIEW", "/sales/permit");
  const [request, options] = await Promise.all([getPermitRequest(Number(id)), permitRequestOptions()]);
  if (!request) notFound();
  return (
    <>
      <PermitRequestForm mode="view" request={request} options={options} can={permitRequestAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_permit_request" rowId={request.id} />
    </>
  );
}
