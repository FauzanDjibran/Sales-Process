import { WorkForm } from "@/components/production/work-form";
import { requirePermission } from "@/lib/erp/auth";
import { workOptions } from "@/lib/erp/production-work";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** `?bucket=` lists the rows a scan in the Workspace Unit opened it on. */
export default async function Page({ searchParams }: { searchParams: Promise<{ bucket?: string }> }) {
  const { bucket } = await searchParams;
  const actor = await requirePermission("PRODUCTION_WORK_CREATE", `${WORK_PATH}/new`);
  const options = await workOptions();
  const ids = (bucket ?? "").split(",").map(Number).filter((n) => n > 0);
  return <WorkForm mode="new" work={null} options={options} can={WORK_WORKFLOW.abilities(actor.permissions)} initialBucketIds={ids} />;
}
