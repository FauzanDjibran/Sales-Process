import { QcForm } from "@/components/production/qc-form";
import { requirePermission } from "@/lib/erp/auth";
import { qcOptions } from "@/lib/erp/production-qc";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_QC_CREATE", `${QC_CHECK_PATH}/new`);
  const options = await qcOptions();
  return <QcForm mode="new" check={null} options={options} can={QC_CHECK_WORKFLOW.abilities(actor.permissions)} />;
}
