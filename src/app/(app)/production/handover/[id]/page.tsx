import { notFound } from "next/navigation";
import { HandoverForm } from "@/components/production/handover-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getHandover, handoverCurrent, handoverOptions } from "@/lib/erp/production-handover";
import { handoverAbilities } from "@/lib/erp/production-handover-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_HANDOVER_VIEW", "/production/handover");
  const handover = await getHandover(Number(id));
  if (!handover) notFound();
  const options = await handoverOptions(handoverCurrent(handover));
  return (
    <>
      <HandoverForm mode="view" handover={handover} options={options} can={handoverAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_handover" rowId={handover.id} />
    </>
  );
}
