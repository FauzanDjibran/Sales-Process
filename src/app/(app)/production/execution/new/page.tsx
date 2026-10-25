import { RunForm } from "@/components/production/run-form";
import { requirePermission } from "@/lib/erp/auth";
import { runOptions } from "@/lib/erp/production-run";
import { executionAbilities } from "@/lib/erp/production-run-workflow";

export const dynamic = "force-dynamic";

/** A new Eksekusi Produksi (P169). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_EXECUTION_CREATE", "/production/execution/new");
  return <RunForm mode="new" run={null} options={await runOptions()} can={executionAbilities(actor.permissions)} />;
}
