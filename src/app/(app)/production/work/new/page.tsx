import { WorkForm } from "@/components/production/work-form";
import { requirePermission } from "@/lib/erp/auth";
import { workOptions } from "@/lib/erp/production-work";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_WORK_CREATE", `${WORK_PATH}/new`);
  const options = await workOptions();
  return <WorkForm mode="new" work={null} options={options} can={WORK_WORKFLOW.abilities(actor.permissions)} />;
}
