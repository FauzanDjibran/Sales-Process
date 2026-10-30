import { ProdDocList } from "@/components/production/production-doc-list";
import { requirePermission } from "@/lib/erp/auth";
import { RELEASE_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { listReleases } from "@/lib/erp/production-release";

export const dynamic = "force-dynamic";

/** The Production Release register (R8). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_RELEASE_VIEW", RELEASE_WORKFLOW.path);
  const rows = (await listReleases()).map((r) => ({ ...r, tag: r.purposeName, places: [r.workstation, r.warehouse] }));
  return (
    <ProdDocList
      crumb="Produksi"
      title="Production Release"
      icon="box"
      sub="Barang keluar dari produksi senilai yang dikandungnya: ke gudang dengan lot yang sama (Dr Persediaan / Cr WIP), atau dimusnahkan (Dr Beban Pemusnahan / Cr WIP)."
      path={RELEASE_WORKFLOW.path}
      rows={rows}
      tagColumn="Tujuan"
      placeColumns={["Workstation", "Gudang"]}
      valueColumn="Nilai"
      canCreate={RELEASE_WORKFLOW.abilities(actor.permissions).create}
      emptyText="Production Release mengeluarkan barang dari Workstation ke gudang atau memusnahkannya."
    />
  );
}
