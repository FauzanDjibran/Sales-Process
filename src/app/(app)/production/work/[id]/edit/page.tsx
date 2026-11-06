import { notFound, redirect } from "next/navigation";
import { WorkForm } from "@/components/production/work-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getWork, workOptions } from "@/lib/erp/production-work";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_WORK_EDIT", `${WORK_PATH}/${id}/edit`);
  const doc = await getWork(Number(id));
  if (!doc) notFound();
  if (doc.status !== "Draft") redirect(`${WORK_PATH}/${doc.id}`);
  const options = await workOptions([...doc.lines.map((l) => l.bucketId), ...doc.aux.map((a) => a.bucketId)]);
  return (
    <>
      <WorkForm mode="edit" work={doc} options={options} can={WORK_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_work" rowId={doc.id} />
    </>
  );
}
