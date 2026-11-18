import { WorkForm } from "@/components/production/work-form";
import { requirePermission } from "@/lib/erp/auth";
import { narrowToUnits } from "@/lib/erp/production-access";
import { workOptions } from "@/lib/erp/production-work";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** `?bucket=` lists the rows picked in the Workspace Unit; `?unit=` opens it empty on a Unit. */
export default async function Page({ searchParams }: { searchParams: Promise<{ bucket?: string; unit?: string }> }) {
  const { bucket, unit } = await searchParams;
  const actor = await requirePermission("PRODUCTION_WORK_CREATE", `${WORK_PATH}/new`);
  const options = await narrowToUnits(actor, await workOptions());
  const unitOf = (label?: string) => (label ? options.units.find((u) => u.label === label)?.id : undefined);
  const ids = (bucket ?? "").split(",").map(Number).filter((n) => n > 0);
  return <WorkForm mode="new" work={null} options={options} can={WORK_WORKFLOW.abilities(actor.permissions)} initialBucketIds={ids} initialUnitId={unitOf(unit)} />;
}
