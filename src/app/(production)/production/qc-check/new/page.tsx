import { QcForm } from "@/components/production/qc-form";
import { requirePermission } from "@/lib/erp/auth";
import { narrowToUnits } from "@/lib/erp/production-access";
import { qcOptions } from "@/lib/erp/production-qc";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** `?bucket=1,2` are the rows picked in the Workspace's QC tab; `?unit=` opens it empty on a Unit. */
export default async function Page({ searchParams }: { searchParams: Promise<{ bucket?: string; unit?: string; n?: string }> }) {
  const { bucket, unit, n } = await searchParams;
  const actor = await requirePermission("PRODUCTION_QC_CREATE", `${QC_CHECK_PATH}/new`);
  const options = await narrowToUnits(actor, await qcOptions());
  const unitOf = (label?: string) => (label ? options.units.find((u) => u.label === label)?.id : undefined);
  return <QcForm key={n ?? "0"} mode="new" check={null} options={options} can={QC_CHECK_WORKFLOW.abilities(actor.permissions)} initialBucketIds={String(bucket ?? "").split(",").map(Number).filter(Boolean)} initialUnitId={unitOf(unit)} />;
}
