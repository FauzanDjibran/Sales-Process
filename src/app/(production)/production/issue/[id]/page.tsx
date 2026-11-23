import { notFound } from "next/navigation";
import { HandoverView } from "@/components/production/handover-view";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { getProductionIssue } from "@/lib/erp/production-issue";
import { PRODUCTION_ISSUE_PATH, PRODUCTION_ISSUE_PURPOSES, PRODUCTION_ISSUE_REASONS, PRODUCTION_ISSUE_STATUS_TEXT } from "@/lib/erp/production-handover-shape";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_ISSUE_VIEW", PRODUCTION_ISSUE_PATH);
  const doc = await getProductionIssue(Number(id));
  if (!doc) notFound();
  await requireUnit(actor, doc.unitId);
  return (
    <>
      <HandoverView
        doc={doc}
        title="Production Issue"
        icon="send"
        base={PRODUCTION_ISSUE_PATH}
        purpose={PRODUCTION_ISSUE_PURPOSES[doc.purpose].name}
        statusText={PRODUCTION_ISSUE_STATUS_TEXT}
        warehouseLabel="Ke Gudang"
        reason={doc.reason ? (PRODUCTION_ISSUE_REASONS[doc.reason] ?? doc.reason) : null}
      />
      <RecordHistoryCard entityKey="prd_issue" rowId={doc.id} />
    </>
  );
}
