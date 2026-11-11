import { notFound } from "next/navigation";
import { WorkForm } from "@/components/production/work-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { narrowToUnits, requireUnit } from "@/lib/erp/production-access";
import { getWork, workOptions } from "@/lib/erp/production-work";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** `?post=1`: the form's *Posting* just saved this Draft, so its confirmation opens (D2). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ post?: string }> }) {
  const { id } = await params;
  const { post } = await searchParams;
  const actor = await requirePermission("PRODUCTION_WORK_VIEW", WORK_PATH);
  const doc = await getWork(Number(id));
  if (!doc) notFound();
  await requireUnit(actor, doc.unitId);
  const options = await narrowToUnits(actor, await workOptions([...doc.lines.map((l) => l.bucketId), ...doc.aux.map((a) => a.bucketId)]));
  return (
    <>
      <WorkForm mode="view" work={doc} options={options} can={WORK_WORKFLOW.abilities(actor.permissions)} autoPost={post === "1"} />
      <RecordHistoryCard entityKey="prd_work" rowId={doc.id} />
    </>
  );
}
