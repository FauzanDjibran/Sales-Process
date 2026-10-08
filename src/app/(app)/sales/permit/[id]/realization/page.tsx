import { notFound, redirect } from "next/navigation";
import { PermitRequestForm } from "@/components/sales/permit-request-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPermitRequest, permitRequestOptions } from "@/lib/erp/permit-request";
import { permitRequestAbilities } from "@/lib/erp/permit-request-workflow";
import { permitCostPayments } from "@/lib/erp/cash-payment";

export const dynamic = "force-dynamic";

/** Input / Ubah Realisasi (Z7): an approved or realised Pengajuan, its estimates locked. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PERMIT_REQUEST_REALIZE", `/sales/permit/${id}/realization`);
  const [request, options] = await Promise.all([getPermitRequest(Number(id)), permitRequestOptions()]);
  if (!request) notFound();
  if (request.status !== "Open" && request.status !== "Realized") redirect(`/sales/permit/${request.id}`);
  // Fixed once its cost is paid (Z8): Posting would refuse it anyway.
  if ((await permitCostPayments(request.id)).length) redirect(`/sales/permit/${request.id}`);
  return (
    <>
      <PermitRequestForm mode="realization" request={request} options={options} can={permitRequestAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_permit_request" rowId={request.id} />
    </>
  );
}
