import { notFound } from "next/navigation";
import { CostCloseDetail } from "@/components/production/cost-close-detail";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { actorCan } from "@/lib/erp/access";
import { requirePermission } from "@/lib/erp/auth";
import { previewClose, storedClose } from "@/lib/erp/production-close";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  const actor = await requirePermission("PRODUCTION_COST_CLOSE_VIEW", "/production/cost-close");
  const id = Number(periodId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const stored = await storedClose(id);
  const preview = stored ? null : await previewClose(id);
  if (!stored && !preview) notFound();
  return (
    <>
      <CostCloseDetail preview={preview} stored={stored} periodId={id} canRun={actorCan(actor, "PRODUCTION_COST_CLOSE_RUN")} />
      {stored && <RecordHistoryCard entityKey="prd_cost_close" rowId={stored.closeId} />}
    </>
  );
}
