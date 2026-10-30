import { ExecutionForm } from "@/components/production/execution-form";
import { requirePermission } from "@/lib/erp/auth";
import { EXECUTION_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { executionOptions } from "@/lib/erp/production-run";

export const dynamic = "force-dynamic";

/** A new Eksekusi Produksi (R5). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_EXECUTION_CREATE", `${EXECUTION_WORKFLOW.path}/new`);
  return <ExecutionForm mode="new" execution={null} options={await executionOptions()} can={EXECUTION_WORKFLOW.abilities(actor.permissions)} />;
}
