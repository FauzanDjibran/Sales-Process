import { notFound } from "next/navigation";
import { CostCloseDetail } from "@/components/production/cost-close-detail";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { previewClose, storedClose } from "@/lib/erp/production-close";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  const actor = await requirePermission("PRODUCTION_COST_CLOSE_VIEW", "/production/cost-close");
  const id = Number(periodId);
  const view = await previewClose(id);
  if (!view) notFound();
  const stored = view.costed ? await storedClose(id) : null;
  return (
    <>
      <CostCloseDetail view={view} stored={stored} canRun={actor.permissions.has("PRODUCTION_COST_CLOSE_RUN")} />
      {stored && <RecordHistoryCard entityKey="prd_cost_close" rowId={stored.closeId} />}
    </>
  );
}
