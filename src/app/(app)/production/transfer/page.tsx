import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { TRANSFER_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { listTransfers } from "@/lib/erp/production-transfer";

export const dynamic = "force-dynamic";

/** The Production Transfer register (R7). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_TRANSFER_VIEW", TRANSFER_WORKFLOW.path);
  const rows = (await listTransfers()).map((r) => ({ ...r, places: [r.from, r.to] }));
  return (
    <ProdDocList
      crumb="Produksi"
      title="Production Transfer"
      icon="truck"
      sub="Lot berpindah langsung dari satu Workstation ke Workstation lain, senilai yang dikandungnya. Tanpa journal: nilainya tetap di WIP."
      path={TRANSFER_WORKFLOW.path}
      rows={rows}
      placeColumns={["Dari Workstation", "Ke Workstation"]}
      valueColumn="Nilai"
      canCreate={TRANSFER_WORKFLOW.abilities(actor.permissions).create}
      emptyText="Production Transfer memindahkan lot antar Workstation: pilih asal, tujuan dan lotnya."
    />
  );
}
