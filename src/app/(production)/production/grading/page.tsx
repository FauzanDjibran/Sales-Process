import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { listGradings } from "@/lib/erp/production-grading";
import { GRADING_PATH, GRADING_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_GRADING_VIEW", GRADING_PATH);
  const rows = await listGradings();
  return (
    <ProdDocList
      crumb="Dokumen"
      title="No. Grading"
      icon="layers"
      sub="Satu No. Stok dari Persiapan menjadi output baru. Jenis dan gram berubah di sini, dan biaya unit masuk saat Posting."
      path={GRADING_PATH}
      rows={rows.map((r) => ({ id: r.id, no: r.no, date: r.date, status: r.status, places: [{ label: r.unitLabel, name: r.unitName }], lines: r.lines, value: r.value }))}
      placeColumns={["Unit"]}
      valueColumn="Nilai Diolah"
      canCreate={GRADING_WORKFLOW.abilities(actor.permissions).create}
      emptyText="No. Grading mencatat pengambilan dari Persiapan unit Grading dan hasilnya."
    />
  );
}
