import { notFound } from "next/navigation";
import { QcForm } from "@/components/production/qc-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { narrowToUnits, requireUnit } from "@/lib/erp/production-access";
import { getQcCheck, qcOptions } from "@/lib/erp/production-qc";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** `?post=1`: the form's *Posting* just saved this Draft, so its confirmation opens (D2). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ post?: string }> }) {
  const { id } = await params;
  const { post } = await searchParams;
  const actor = await requirePermission("PRODUCTION_QC_VIEW", QC_CHECK_PATH);
  const doc = await getQcCheck(Number(id));
  if (!doc) notFound();
  await requireUnit(actor, doc.unitId);
  const options = await narrowToUnits(actor, await qcOptions(doc.lines.map((l) => l.bucketId)));
  return (
    <>
      <QcForm mode="view" check={doc} options={options} can={QC_CHECK_WORKFLOW.abilities(actor.permissions)} autoPost={post === "1"} />
      <RecordHistoryCard entityKey="prd_qc_check" rowId={doc.id} />
    </>
  );
}
