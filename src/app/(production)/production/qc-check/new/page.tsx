import { QcForm } from "@/components/production/qc-form";
import { requirePermission } from "@/lib/erp/auth";
import { narrowToUnits } from "@/lib/erp/production-access";
import { qcOptions } from "@/lib/erp/production-qc";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** `?bucket=` is the row a scan in the Workspace Unit opened it on. */
export default async function Page({ searchParams }: { searchParams: Promise<{ bucket?: string }> }) {
  const { bucket } = await searchParams;
  const actor = await requirePermission("PRODUCTION_QC_CREATE", `${QC_CHECK_PATH}/new`);
  const options = await narrowToUnits(actor, await qcOptions());
  return <QcForm mode="new" check={null} options={options} can={QC_CHECK_WORKFLOW.abilities(actor.permissions)} initialBucketId={Number(bucket) || undefined} />;
}
