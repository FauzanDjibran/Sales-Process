import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listQcChecks } from "@/lib/erp/production-qc";
import { QC_CHECK_PATH, QC_CHECK_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_QC_VIEW", QC_CHECK_PATH);
  const rows = await listQcChecks(await unitIdsOf(actor));
  return (
    <ProdDocList
      crumb="Dokumen"
      title="QC Check"
      icon="check"
      sub="QC memvalidasi hasil proses: Lulus masuk Stand By, Balik kembali ke Persiapan unit itu. Tanpa journal."
      path={QC_CHECK_PATH}
      rows={rows.map((r) => ({ id: r.id, no: r.no, date: r.date, status: r.status, places: [{ label: r.unitLabel, name: r.unitName }], lines: r.lines, value: null }))}
      placeColumns={["Unit"]}
      
      canCreate={QC_CHECK_WORKFLOW.abilities(actor.permissions).create}
      emptyText="QC Check dibuat untuk hasil proses yang menunggu di unit ber-QC."
    />
  );
}
