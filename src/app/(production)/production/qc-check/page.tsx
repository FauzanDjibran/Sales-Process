import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listQcChecks } from "@/lib/erp/production-qc";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_QC_VIEW", QC_CHECK_PATH);
  const own = await unitIdsOf(actor);
  const rows = await listQcChecks(own);
  return (
    <ProdDocList
      crumb="Dokumen"
      title="QC Check"
      icon="check"
      sub={own ? "Dokumen dari Unit yang ditugaskan ke Anda. Dokumen dibuat dari Workspace Unit." : "Dokumen dibuat dari Workspace Unit."}
      path={QC_CHECK_PATH}
      rows={rows.map((r) => ({ id: r.id, no: r.no, date: r.date, status: r.status, places: [{ label: r.unitLabel, name: r.unitName }], partai: r.partaiNo, lines: r.lines, grams: r.grams, value: null }))}
      placeColumns={["Unit"]}
      
      canCreate={QC_CHECK_WORKFLOW.abilities(actor.permissions).create}
      emptyText="QC Check dibuat untuk hasil proses yang menunggu di unit ber-QC."
    />
  );
}
