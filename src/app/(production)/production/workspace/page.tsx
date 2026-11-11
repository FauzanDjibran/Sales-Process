import { redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { UnitCards } from "@/components/production/unit-cards";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { incomingStockIssues } from "@/lib/erp/stock-issue";
import { unitCards } from "@/lib/erp/production-workspace";

export const dynamic = "force-dynamic";

/** One door to every Unit; adding a Unit adds a card, never a menu. */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_UNIT_VIEW", "/production/workspace");
  // Only the Units assigned on the User form, unless PRODUCTION_UNIT_ALL (P260).
  const own = await unitIdsOf(actor);
  const [data, issues] = await Promise.all([unitCards(own), incomingStockIssues()]);
  // A user with exactly one Unit goes straight to it (production_app_plan.md §3.3).
  if (own && data.units.length === 1) redirect(`/production/workspace/${encodeURIComponent(data.units[0].label)}`);

  const incoming: Record<number, { docs: number; grams: number }> = {};
  for (const i of issues) {
    const t = (incoming[i.unitId] ??= { docs: 0, grams: 0 });
    t.docs += 1;
    t.grams += i.lines.reduce((a, l) => a + (l.uomLabel === "GR" ? l.qty : 0), 0);
  }

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pengerjaan</span>
          <span>/</span>
          <span className="cur">Workspace Unit</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="layers" size={16} />
            </span>
            Workspace Unit
          </h1>
        </div>
        <p className="ph-sub">{own ? "Unit yang ditugaskan ke Anda." : "Pilih Unit untuk bekerja. Kartu meringkas barang di tiap tahap."}</p>
      </div>
      <UnitCards data={data} incoming={incoming} own={own !== null} />
    </>
  );
}
