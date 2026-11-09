import Link from "next/link";
import { Icon } from "@/components/icon";
import { requirePermission } from "@/lib/erp/auth";
import { incomingStockIssues } from "@/lib/erp/stock-issue";
import { unitCards } from "@/lib/erp/production-workspace";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const PROCESS_TEXT = { PassThrough: "Pass Through", Grading: "Grading", Assembly: "Assembly" } as const;
const gram = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/** One door to every Unit; adding a Unit adds a card, never a menu. */
export default async function Page() {
  await requirePermission("PRODUCTION_UNIT_VIEW", "/production/workspace");
  const [units, incoming] = await Promise.all([unitCards(), incomingStockIssues()]);
  const masuk = new Map<number, number>();
  for (const i of incoming) masuk.set(i.unitId, (masuk.get(i.unitId) ?? 0) + 1);
  const groups = [...new Set(units.map((u) => u.workstation ?? "Tanpa Workstation"))];

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
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
        <p className="ph-sub">Pilih Unit untuk bekerja. Di dalam Unit, scan label No. Stok atau No. Job: layar langsung membuka satu form untuk satu pekerjaan.</p>
      </div>

      {groups.map((g) => (
        <section key={g}>
          <div className="uw-ws">{g}</div>
          <div className="uw-grid">
            {units
              .filter((u) => (u.workstation ?? "Tanpa Workstation") === g)
              .map((u) => {
                const n = (label: string, rows: number, grams: number | null, hot = false) => (
                  <div className={hot && rows ? "hot" : ""}>
                    <label>{label}</label>
                    <b className={rows ? "" : "z"}>{rows}</b>
                    <small>{rows && grams != null ? `${gram(grams)} g` : "—"}</small>
                  </div>
                );
                return (
                  <Link key={u.id} className="uw-card" href={`/production/workspace/${encodeURIComponent(u.label)}`}>
                    <span className="uw-card-h">
                      <span className="lab lg">{u.label}</span>
                      <b>{u.name}</b>
                    </span>
                    <span className="uw-tags">
                      <span className="bdg t-info">{PROCESS_TEXT[u.process]}</span>
                      {u.hasQc && <span className="bdg t-ok">QC</span>}
                    </span>
                    <span className="uw-nums">
                      {n("Masuk", masuk.get(u.id) ?? 0, null, true)}
                      {n("Persiapan", u.preparation.rows, u.preparation.grams)}
                      {u.hasQc ? n("QC", u.qc.rows, u.qc.grams, true) : (
                        <div>
                          <label>QC</label>
                          <b className="z">—</b>
                          <small>tanpa QC</small>
                        </div>
                      )}
                      {n("Stand By", u.standBy.rows, u.standBy.grams)}
                    </span>
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
      {!units.length && (
        <div className="card">
          <div className="empty">
            <h4>Belum ada Unit</h4>
            <p>Unit dibuat di Master › Produksi.</p>
          </div>
        </div>
      )}
    </>
  );
}
