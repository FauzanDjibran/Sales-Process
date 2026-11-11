import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listWorks } from "@/lib/erp/production-work";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_WORK_VIEW", WORK_PATH);
  const own = await unitIdsOf(actor);
  const rows = await listWorks(own);
  return (
    <ProdDocList
      crumb="Dokumen"
      title="Pengerjaan Unit"
      icon="check"
      sub={own ? "Dokumen dari Unit yang ditugaskan ke Anda. Dokumen dibuat dari Workspace Unit." : "Dokumen dibuat dari Workspace Unit."}
      path={WORK_PATH}
      rows={rows.map((r) => ({ id: r.id, no: r.no, date: r.date, status: r.status, places: [{ label: r.unitLabel, name: r.unitName }], partai: r.partaiNo, lines: r.lines, grams: r.grams, value: r.value }))}
      placeColumns={["Unit"]}
      valueColumn="Biaya"
      canCreate={WORK_WORKFLOW.abilities(actor.permissions).create}
      emptyText="Pengerjaan Unit menyatakan Job sudah dikerjakan di unit Pass Through."
    />
  );
}
