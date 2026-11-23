import Link from "next/link";
import { Icon } from "@/components/icon";
import type { TraceNode, TraceReport } from "@/lib/erp/production-report";
import { reportHref } from "@/lib/erp/reports";
import { formatDate, formatNumber } from "@/lib/format";

const qty = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/*
 * Telusur Produksi; Saldo and Kartu Produksi are in `production-card-reports.tsx`.
 * These reports live in the Produksi application, whose screens show no
 * prices (P275): quantities, stages and identities only. The values stay in
 * the books, which the ERP reads.
 */

const lotHref = (lotNo: string) => reportHref("production-card", { lots: lotNo });

/** The warning a production report shows when a balance table no longer equals its ledger. */
export function ProductionMismatch({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="nbox bad slim" style={{ marginTop: 14 }}>
      <Icon name="warn" size={15} className="ni" />
      <div>
        <b>Saldo produksi tidak sama dengan buku produksinya.</b> Jalankan <span className="mono">npm run db:reconcile</span> dan periksa sebelum memakai angka ini.
      </div>
    </div>
  );
}

/** A document's number, linked when it has a page. */
function Doc({ no, href }: { no: string; href: string | null }) {
  return href ? (
    <Link className="mono" href={href}>
      {no}
    </Link>
  ) : (
    <span className="mono">{no}</span>
  );
}

function TraceTable({ title, lead, nodes, dir }: { title: string; lead: string; nodes: TraceNode[]; dir: "back" | "fwd" | "start" }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <div className="ct">
          <h3>{title}</h3>
          <p>{lead}</p>
        </div>
      </div>
      {nodes.length ? (
        <div className="tw">
          <table className="grid" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th className="num" style={{ width: 70 }}>
                  Langkah
                </th>
                <th style={{ width: 200 }}>No. Stok</th>
                <th>Barang</th>
                {dir !== "start" && <th style={{ width: 300 }}>{dir === "back" ? "Dipakai oleh" : "Dibuat oleh"}</th>}
                <th style={{ width: 320 }}>{dir === "back" ? "Asal" : "Sekarang"}</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.lotId}>
                  <td className="num">{n.depth}</td>
                  <td>
                    <Link className="mono" href={lotHref(n.lotNo)}>
                      {n.lotNo}
                    </Link>
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{n.itemLabel}</span>
                      <span className="nm">{n.itemName}</span>
                    </span>
                  </td>
                  {dir !== "start" && (
                    <td>
                      <span className="dstack" style={{ gap: 2 }}>
                        {n.via.map((e) => (
                          <span key={e.sourceNo} className="d2">
                            <Doc no={e.sourceNo} href={e.href} /> · {e.stationLabel} · {qty(e.qty)} {dir === "back" ? n.uom : ""}
                          </span>
                        ))}
                      </span>
                    </td>
                  )}
                  <td>
                    <span className="dstack" style={{ gap: 2 }}>
                      {n.origin && (
                        <span className="d2">
                          Asal <Doc no={n.origin.sourceNo} href={n.origin.href} />
                          {n.origin.supplier ? ` · ${n.origin.supplier}` : ""}
                        </span>
                      )}
                      {n.now?.production.map((p, i) => (
                        <span key={`p${i}`} className="d2">
                          Produksi · {p.stationLabel} · {p.stage} · {qty(p.qty)} {n.uom}
                        </span>
                      ))}
                      {n.now?.stock.map((s, i) => (
                        <span key={`s${i}`} className="d2">
                          Stok · {s.where} · {qty(s.qty)} {n.uom}
                        </span>
                      ))}
                      {n.now?.delivered.map((d, i) => (
                        <span key={`d${i}`} className="d2">
                          Terkirim · <span className="mono">{d.noteNo}</span> {formatDate(d.date)} · {d.to} · {qty(d.qty)} {n.uom}
                        </span>
                      ))}
                      {!n.origin && n.now && !n.now.production.length && !n.now.stock.length && !n.now.delivered.length && <span className="dash">habis dipakai</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <h4>Tidak ada</h4>
        </div>
      )}
    </div>
  );
}

/** Telusur Produksi (R27): the lot, where it came from, where it went. */
export function TraceBody({ report }: { report: TraceReport }) {
  return (
    <>
      <TraceTable title="No. Stok yang Ditelusuri" lead="No. Stok dengan nomor ini — satu per barang — dan di mana ia sekarang." nodes={report.start} dir="start" />
      <TraceTable title="Asal (Mundur)" lead="Lewat setiap eksekusi sampai No. Stok yang masuk dari supplier atau injeksi." nodes={report.backward} dir="back" />
      <TraceTable title="Tujuan (Maju)" lead="Lewat setiap eksekusi sampai barang di unit, di stok, atau terkirim ke customer." nodes={report.forward} dir="fwd" />
      {report.truncated && (
        <div className="nbox warn slim" style={{ marginTop: 14 }}>
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>Penelusuran dipotong.</b> Terlalu banyak No. Stok; telusuri dari No. Stok yang lebih dekat ke ujung yang dicari.
          </div>
        </div>
      )}
    </>
  );
}
