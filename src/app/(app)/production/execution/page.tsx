import { RunList } from "@/components/production/run-list";
import { requirePermission } from "@/lib/erp/auth";
import { listRuns } from "@/lib/erp/production-run";
import { executionAbilities } from "@/lib/erp/production-run-workflow";

export const dynamic = "force-dynamic";

/** The Eksekusi Produksi register (P169). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_EXECUTION_VIEW", "/production/execution");
  return <RunList runs={await listRuns()} can={executionAbilities(actor.permissions)} />;
}
