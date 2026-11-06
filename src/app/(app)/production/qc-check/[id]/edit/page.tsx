import { notFound, redirect } from "next/navigation";
import { QcForm } from "@/components/production/qc-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getQcCheck, qcOptions } from "@/lib/erp/production-qc";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_QC_EDIT", `${QC_CHECK_PATH}/${id}/edit`);
  const doc = await getQcCheck(Number(id));
  if (!doc) notFound();
  if (doc.status !== "Draft") redirect(`${QC_CHECK_PATH}/${doc.id}`);
  const options = await qcOptions(doc.lines.map((l) => l.bucketId));
  return (
    <>
      <QcForm mode="edit" check={doc} options={options} can={QC_CHECK_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_qc_check" rowId={doc.id} />
    </>
  );
}
