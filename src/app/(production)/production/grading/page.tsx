import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listGradings } from "@/lib/erp/production-grading";
import { GRADING_PATH, GRADING_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_GRADING_VIEW", GRADING_PATH);
  const own = await unitIdsOf(actor);
  const rows = await listGradings(own);
  return (
    <ProdDocList
      crumb="Dokumen"
      title="No. Grading"
      icon="layers"
      sub={own ? "Dokumen dari Unit yang ditugaskan ke Anda. Dokumen dibuat dari Workspace Unit." : "Dokumen dibuat dari Workspace Unit."}
      path={GRADING_PATH}
      rows={rows.map((r) => ({ id: r.id, no: r.no, date: r.date, status: r.status, places: [{ label: r.unitLabel, name: r.unitName }], partai: r.partaiNo, lines: r.lines, grams: r.grams, value: r.value }))}
      placeColumns={["Unit"]}
      valueColumn="Nilai Diolah"
      canCreate={GRADING_WORKFLOW.abilities(actor.permissions).create}
      emptyText="No. Grading mencatat pengambilan dari Persiapan unit Grading dan hasilnya."
    />
  );
}
