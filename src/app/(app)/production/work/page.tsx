import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { listWorks } from "@/lib/erp/production-work";
import { WORK_PATH, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_WORK_VIEW", WORK_PATH);
  const rows = await listWorks();
  return (
    <ProdDocList
      crumb="Produksi"
      title="Pengerjaan Unit"
      icon="check"
      sub="No. Job yang dikerjakan di unit Pass Through dan oleh siapa. Barang dan gram tetap; biaya unit menambah nilainya."
      path={WORK_PATH}
      rows={rows.map((r) => ({ id: r.id, no: r.no, date: r.date, status: r.status, places: [{ label: r.unitLabel, name: r.unitName }], lines: r.lines, value: r.value }))}
      placeColumns={["Unit"]}
      valueColumn="Biaya"
      canCreate={WORK_WORKFLOW.abilities(actor.permissions).create}
      emptyText="Pengerjaan Unit menyatakan Job sudah dikerjakan di unit Pass Through."
    />
  );
}
