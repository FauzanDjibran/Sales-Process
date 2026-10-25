import { notFound, redirect } from "next/navigation";
import { RunForm } from "@/components/production/run-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getRun, runCurrent, runOptions } from "@/lib/erp/production-run";
import { executionAbilities, executionIsEditable } from "@/lib/erp/production-run-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_EXECUTION_EDIT", `/production/execution/${id}/edit`);
  const run = await getRun(Number(id));
  if (!run) notFound();
  if (!executionIsEditable(run.status)) redirect(`/production/execution/${run.id}`);
  return (
    <>
      <RunForm mode="edit" run={run} options={await runOptions(runCurrent(run))} can={executionAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_execution" rowId={run.id} />
    </>
  );
}
