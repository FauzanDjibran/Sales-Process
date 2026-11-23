import { HandoverList } from "@/components/production/handover-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listProductionIssues } from "@/lib/erp/production-issue";
import { PRODUCTION_ISSUE_PATH, PRODUCTION_ISSUE_PURPOSES, PRODUCTION_ISSUE_STATUS_TEXT } from "@/lib/erp/production-handover-shape";

export const dynamic = "force-dynamic";

/** The Production Issue register (P317), narrowed to the user's Units (P260). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_ISSUE_VIEW", PRODUCTION_ISSUE_PATH);
  const rows = await listProductionIssues(await unitIdsOf(actor));
  return (
    <HandoverList
      title="Production Issue"
      sub="Barang keluar produksi ke gudang. Dokumen dibuat dari Workspace Unit."
      icon="send"
      base={PRODUCTION_ISSUE_PATH}
      statusText={PRODUCTION_ISSUE_STATUS_TEXT}
      warehouseHead="Ke Gudang"
      rows={rows.map((r) => ({ ...r, purpose: PRODUCTION_ISSUE_PURPOSES[r.purpose].name }))}
    />
  );
}
