import { notFound, redirect } from "next/navigation";
import { ExecutionForm } from "@/components/production/execution-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { EXECUTION_WORKFLOW, prodDocIsEditable } from "@/lib/erp/production-doc-workflow";
import { executionCurrent, executionOptions, getExecution } from "@/lib/erp/production-run";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_EXECUTION_EDIT", `${EXECUTION_WORKFLOW.path}/${id}/edit`);
  const execution = await getExecution(Number(id));
  if (!execution) notFound();
  if (!prodDocIsEditable(execution.status)) redirect(`${EXECUTION_WORKFLOW.path}/${execution.id}`);
  return (
    <>
      <ExecutionForm mode="edit" execution={execution} options={await executionOptions(executionCurrent(execution))} can={EXECUTION_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_execution" rowId={execution.id} />
    </>
  );
}
