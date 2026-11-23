import Link from "next/link";
import { Icon } from "@/components/icon";
import { MOVEMENT_LABEL, type LotCard, type TraceNode, type TraceReport, type WipBlock } from "@/lib/erp/production-report";
import { reportHref } from "@/lib/erp/reports";
import { formatDate, formatNumber } from "@/lib/format";

const qty = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/*
 * These reports live in the Produksi application, whose screens show no
 * prices (P275): quantities, stages and identities only. The values stay in
 * the books, which the ERP reads.
 */

const lotHref = (lotNo: string) => reportHref("lot-card", { q: lotNo });

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

/** Saldo Produksi: a block per unit, a row per bucket in the order it passes through the Unit (R18, P305). */
export function WipBalanceBody({ blocks, asOf }: { blocks: WipBlock[]; asOf: string }) {
  if (!blocks.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="layers" size={20} />
        </div>
        <h4>Tidak ada barang di produksi</h4>
        <p>Pada {formatDate(asOf)} tidak ada barang di produksi menurut filter ini.</p>
      </div>
    );
  }
  return (
    <>
      {blocks.map((b) => (
        <div key={b.stationId} className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <span className="ci">
              <Icon name="gear" size={15} />
            </span>
            <div className="ct">
              <h3>
                <span className="lab">{b.stationLabel}</span> {b.stationName}
              </h3>
              <p>{b.rows.length} baris</p>
            </div>
          </div>
          <div className="tw">
            <table className="grid" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: 190 }}>Tahap</th>
                  <th style={{ width: 190 }}>No. Job</th>
                  <th style={{ width: 200 }}>No. Stok</th>
                  <th>Barang</th>
                  <th className="num" style={{ width: 130 }}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.bucketId}>
                    <td>{r.stage}</td>
                    <td>{r.jobNo ? <span className="mono">{r.jobNo}</span> : <span className="dash">—</span>}</td>
                    <td>
                      <Link className="mono" href={lotHref(r.lotNo)}>
                        {r.lotNo}
                      </Link>
                    </td>
                    <td>
                      <span className="idc">
                        <span className="lab">{r.itemLabel}</span>
                        <span className="nm">{r.itemName}</span>
                      </span>
                    </td>
                    <td className="num">
                      <span className="mny">
                        {qty(r.qty)} {r.uom}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

/** Kartu Lot: each lot of the number, then its production movements, then its stock movements (R18). */
export function LotCardBody({ cards }: { cards: LotCard[] }) {
  return (
    <>
      {cards.map((card) => (
        <div key={card.lotId}>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <span className="ci">
                <Icon name="book" size={15} />
              </span>
              <div className="ct">
                <h3>
                  <span className="mono">{card.lotNo}</span>
                </h3>
                <p>
                  {card.itemLabel} · {card.itemName} · satuan {card.uom}
                  {card.expiry ? ` · kadaluarsa ${formatDate(card.expiry)}` : ""} · asal {card.sourceNo}
                  {card.supplier ? ` · supplier ${card.supplier}` : ""}
                </p>
              </div>
              <Link className="btn sm" href={reportHref("trace", { q: card.lotNo })}>
                <Icon name="tree" size={14} /> Telusur
              </Link>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <div className="ct">
                <h3>Di Produksi</h3>
                <p>Setiap mutasi buku produksi atas No. Stok ini, per unit dan tahap, dengan saldonya setelah itu.</p>
              </div>
            </div>
            {card.inProduction.length ? (
              <div className="tw">
                <table className="grid" style={{ minWidth: 1000 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Tanggal</th>
                      <th style={{ width: 150 }}>No. Mutasi</th>
                      <th style={{ width: 170 }}>Dokumen</th>
                      <th style={{ width: 140 }}>Mutasi</th>
                      <th style={{ width: 90 }}>Unit</th>
                      <th>Tahap</th>
                      <th className="num" style={{ width: 110 }}>Qty</th>
                      <th className="num" style={{ width: 110 }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.inProduction.map((m, i) => (
                      <tr key={i}>
                        <td>{formatDate(m.date)}</td>
                        <td>
                          <span className="mono">{m.ledgerNo}</span>
                        </td>
                        <td>
                          <span className="mono">{m.sourceNo}</span>
                        </td>
                        <td>{MOVEMENT_LABEL[m.movement] ?? m.movement}</td>
                        <td>
                          <span className="lab">{m.stationLabel}</span>
                        </td>
                        <td>{m.stage}</td>
                        <td className="num">
                          <span className="mny">{qty(m.qtyChange)}</span>
                        </td>
                        <td className="num">
                          <span className="mny">{qty(m.qtyBalance)}</span>
                        </td>

                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty sm">
                <h4>No. Stok ini belum pernah di produksi</h4>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <div className="ct">
                <h3>Di Stok</h3>
                <p>Mutasi buku stok atas No. Stok ini — masuk dari penerimaan atau hasil produksi, keluar ke produksi atau pengiriman.</p>
              </div>
            </div>
            {card.inStock.length ? (
              <div className="tw">
                <table className="grid" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>Tanggal</th>
                      <th style={{ width: 150 }}>No. Mutasi</th>
                      <th style={{ width: 190 }}>Dokumen</th>
                      <th>Gudang</th>
                      <th className="num" style={{ width: 120 }}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.inStock.map((m, i) => (
                      <tr key={i}>
                        <td>{formatDate(m.date)}</td>
                        <td>
                          <span className="mono">{m.ledgerNo}</span>
                        </td>
                        <td>
                          <span className="mono">{m.sourceNo}</span>
                        </td>
                        <td>
                          <span className="lab">{m.warehouseLabel}</span>
                          {m.locationLabel && <span className="d2"> {m.locationLabel}</span>}
                        </td>
                        <td className="num">
                          <span className="mny">{qty(m.qtyChange)}</span>
                        </td>

                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty sm">
                <h4>No. Stok ini belum pernah di stok</h4>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
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
                            <span className="mono">{e.sourceNo}</span> · {e.stationLabel} · {qty(e.qty)} {dir === "back" ? n.uom : ""}
                          </span>
                        ))}
                      </span>
                    </td>
                  )}
                  <td>
                    <span className="dstack" style={{ gap: 2 }}>
                      {n.origin && (
                        <span className="d2">
                          Asal <span className="mono">{n.origin.sourceNo}</span>
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
