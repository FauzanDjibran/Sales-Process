import { notFound } from "next/navigation";
import { PermitRequestForm } from "@/components/sales/permit-request-form";
import { PermitRequestLinksCard, type PermitLink } from "@/components/sales/permit-request-links";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPermitRequest, permitRequestOptions } from "@/lib/erp/permit-request";
import { permitRequestAbilities } from "@/lib/erp/permit-request-workflow";
import { permitAdvancesOfRequest } from "@/lib/erp/permit-advance";
import { permitCostPayments } from "@/lib/erp/cash-payment";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PERMIT_REQUEST_VIEW", "/sales/permit");
  const [request, options] = await Promise.all([getPermitRequest(Number(id)), permitRequestOptions()]);
  if (!request) notFound();
  // The flow's other documents belong to other modules; this page composes them.
  const [advances, costs] = await Promise.all([permitAdvancesOfRequest(request.id), permitCostPayments(request.id)]);
  const links: PermitLink[] = [
    ...advances.map((a) => ({ kind: "advance" as const, id: a.id, no: a.advanceNo, status: a.status, amount: a.total, paid: a.paid })),
    ...costs.map((p) => ({ kind: "cost" as const, id: p.id, no: p.txNo, date: p.date, status: p.status, amount: p.settled })),
  ];
  // The realisation is fixed once its cost is paid or it is invoiced (Z8).
  const realizationLocked = costs.length > 0;
  return (
    <>
      <PermitRequestForm
        mode="view"
        request={request}
        options={options}
        can={permitRequestAbilities(actor.permissions)}
        realizationLocked={realizationLocked}
      />
      {request.status !== "Draft" && request.status !== "Submitted" && <PermitRequestLinksCard links={links} />}
      <RecordHistoryCard entityKey="sal_permit_request" rowId={request.id} />
    </>
  );
}
