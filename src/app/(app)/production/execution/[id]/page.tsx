import { notFound } from "next/navigation";
import { ExecutionForm } from "@/components/production/execution-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { EXECUTION_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { executionCurrent, executionOptions, getExecution } from "@/lib/erp/production-run";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_EXECUTION_VIEW", EXECUTION_WORKFLOW.path);
  const execution = await getExecution(Number(id));
  if (!execution) notFound();
  // The journal Posting would write is asked for by the dialog as a dry run (P103).
  const options = await executionOptions(executionCurrent(execution));
  return (
    <>
      <ExecutionForm mode="view" execution={execution} options={options} can={EXECUTION_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_execution" rowId={execution.id} />
    </>
  );
}
