import { notFound } from "next/navigation";
import { RunForm } from "@/components/production/run-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getRun, runCurrent, runOptions } from "@/lib/erp/production-run";
import { executionAbilities } from "@/lib/erp/production-run-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_EXECUTION_VIEW", "/production/execution");
  const run = await getRun(Number(id));
  if (!run) notFound();
  // The journal Posting would write is not read here: the Posting dialog asks for it as a dry run (P103).
  const options = await runOptions(runCurrent(run));
  return (
    <>
      <RunForm mode="view" run={run} options={options} can={executionAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_execution" rowId={run.id} />
    </>
  );
}
