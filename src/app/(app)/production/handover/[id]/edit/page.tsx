import { notFound, redirect } from "next/navigation";
import { HandoverForm } from "@/components/production/handover-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getHandover, handoverCurrent, handoverOptions } from "@/lib/erp/production-handover";
import { handoverAbilities, handoverIsEditable } from "@/lib/erp/production-handover-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_HANDOVER_EDIT", `/production/handover/${id}/edit`);
  const handover = await getHandover(Number(id));
  if (!handover) notFound();
  if (!handoverIsEditable(handover.status)) redirect(`/production/handover/${handover.id}`);
  const options = await handoverOptions(handoverCurrent(handover));
  return (
    <>
      <HandoverForm mode="edit" handover={handover} options={options} can={handoverAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_handover" rowId={handover.id} />
    </>
  );
}
