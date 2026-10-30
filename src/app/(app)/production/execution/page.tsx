import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { EXECUTION_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { listExecutions } from "@/lib/erp/production-run";

export const dynamic = "force-dynamic";

/** The Eksekusi Produksi register (R5). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_EXECUTION_VIEW", EXECUTION_WORKFLOW.path);
  const rows = (await listExecutions()).map((r) => ({ ...r, places: [{ label: r.workstationLabel, name: r.workstationName }] }));
  return (
    <ProdDocList
      crumb="Produksi"
      title="Eksekusi Produksi"
      icon="gear"
      sub="Pengerjaan di satu Workstation: input dipakai, output menjadi lot baru senilai input yang dibagi menurut Qty × Bobot Nilai."
      path={EXECUTION_WORKFLOW.path}
      rows={rows}
      placeColumns={["Workstation"]}
      valueColumn="Nilai"
      canCreate={EXECUTION_WORKFLOW.abilities(actor.permissions).create}
      emptyText="Eksekusi mengubah barang di Workstation menjadi lot baru: pilih Workstation, input, output dan Driver-nya."
    />
  );
}
