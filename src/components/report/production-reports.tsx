import Link from "next/link";
import { Icon } from "@/components/icon";
import type { LotCard, RecapStation, TraceNode, TraceReport, WipBlock } from "@/lib/erp/production-report";
import { formatDate, formatMoney, formatNumber, formatPrice } from "@/lib/format";

const qty = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const money = (n: number) => formatMoney(n, "IDR");

/** A figure that is nothing reads as a dash, like the other reports. */
const dash = <span className="dash">—</span>;

/** The warning every production report shows when a balance table no longer equals its ledger. */
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

const STATUS_BADGE = { Tersedia: "s-ok", Reject: "s-bad", "Dalam perjalanan": "s-info" } as const;

/** Saldo Produksi: a block per Partai, a row per bucket (P171). */
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
  const total = blocks.reduce((s, b) => s + b.value, 0);
  return (
    <>
      {blocks.map((b) => (
        <div key={b.partaiId ?? "none"} className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <span className="ci">
              <Icon name="layers" size={15} />
            </span>
            <div className="ct">
              <h3>{b.partaiNo ? <span className="mono">{b.partaiNo}</span> : "Belum di Partai"}</h3>
              <p>{b.partaiNo ? (b.targetLabel ? `Item Target ${b.targetLabel}` : "") : "Lot yang diterima Workstation sebelum hand-over pertama memulai Partainya."}</p>
            </div>
            <span className="mny">{money(b.value)}</span>
          </div>
          <div className="tw">
            <table className="grid" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Workstation</th>
                  <th style={{ width: 190 }}>Job</th>
                  <th>Barang</th>
                  <th style={{ width: 170 }}>Lot</th>
                  <th style={{ width: 130 }}>Status</th>
                  <th className="num" style={{ width: 120 }}>Qty</th>
                  <th className="num" style={{ width: 150 }}>Nilai</th>
                  <th className="num" style={{ width: 120 }}>Per Unit</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.bucketId}>
                    <td>
                      <span className="lab" title={r.stationName}>
                        {r.stationLabel}
                      </span>
                    </td>
                    <td>{r.jobNo ? <span className="mono">{r.jobNo}</span> : dash}</td>
                    <td>
                      <span className="idc">
                        <span className="lab">{r.itemLabel}</span>
                        <span className="nm">{r.itemName}</span>
                      </span>
                    </td>
                    <td>
                      <Link className="mono" href={`/production/report/lot-card?q=${encodeURIComponent(r.lotNo)}`}>
                        {r.lotNo}
                      </Link>
                    </td>
                    <td>
                      <span className={`bdg ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                    </td>
                    <td className="num">
                      <span className="mny">
                        {qty(r.qty)} {r.uom}
                      </span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(r.value)}</span>
                    </td>
                    <td className="num">{r.value ? <span className="mny">{formatPrice(r.unitCost)}</span> : dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <div className="ct">
            <h3>Total WIP</h3>
            <p>Nilai seluruh barang di produksi pada {formatDate(asOf)}.</p>
          </div>
          <span className="mny">{money(total)}</span>
        </div>
      </div>
    </>
  );
}

/** Kartu Lot: the lot, then its production movements, then its stock movements (P171). */
export function LotCardBody({ card }: { card: LotCard }) {
  return (
    <>
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
              {card.expiry ? ` · kadaluarsa ${formatDate(card.expiry)}` : ""}
              {card.sourceNo ? ` · asal ${card.sourceNo}` : ""}
              {card.supplier ? ` · supplier ${card.supplier}` : ""}
            </p>
          </div>
          <Link className="btn sm" href={`/production/report/trace?q=${encodeURIComponent(card.lotNo)}`}>
            <Icon name="tree" size={14} /> Telusur
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <div className="ct">
            <h3>Di Produksi</h3>
            <p>Setiap mutasi buku produksi atas lot ini, dengan saldo dan nilainya setelah itu.</p>
          </div>
        </div>
        {card.inProduction.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 1040 }}>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Tanggal</th>
                  <th style={{ width: 150 }}>No. Mutasi</th>
                  <th style={{ width: 210 }}>Dokumen</th>
                  <th style={{ width: 110 }}>Mutasi</th>
                  <th style={{ width: 120 }}>Workstation</th>
                  <th>Partai · Job</th>
                  <th className="num" style={{ width: 110 }}>Qty</th>
                  <th className="num" style={{ width: 110 }}>Saldo</th>
                  <th className="num" style={{ width: 140 }}>Nilai</th>
                  <th className="num" style={{ width: 150 }}>Saldo Nilai</th>
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
                    <td>{m.movement}</td>
                    <td>
                      <span className="lab">{m.stationLabel}</span>
                      {m.inTransit && <span className="d2"> dalam perjalanan</span>}
                    </td>
                    <td>
                      <span className="dstack">
                        {m.partaiNo ? <span className="mono">{m.partaiNo}</span> : dash}
                        {m.jobNo && <span className="d2 mono">{m.jobNo}</span>}
                      </span>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(m.qtyChange)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(m.qtyBalance)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(m.valueChange)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(m.valueBalance)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Lot ini belum pernah di produksi</h4>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <div className="ct">
            <h3>Di Stok</h3>
            <p>Mutasi buku stok atas lot ini — masuk dari penerimaan atau hasil produksi, keluar ke produksi atau pengiriman.</p>
          </div>
        </div>
        {card.inStock.length ? (
          <div className="tw">
            <table className="grid" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Tanggal</th>
                  <th style={{ width: 150 }}>No. Mutasi</th>
                  <th style={{ width: 210 }}>Dokumen</th>
                  <th>Gudang</th>
                  <th className="num" style={{ width: 120 }}>Qty</th>
                  <th className="num" style={{ width: 150 }}>Nilai</th>
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
                    <td className="num">
                      <span className="mny">{money(m.value)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty sm">
            <h4>Lot ini belum pernah di stok</h4>
          </div>
        )}
      </div>
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
          <table className="grid" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Langkah</th>
                <th style={{ width: 200 }}>Lot</th>
                <th>Barang</th>
                <th style={{ width: 280 }}>{dir === "back" ? "Dibuat oleh" : dir === "fwd" ? "Menjadi lewat" : ""}</th>
                <th>{dir === "back" ? "Asal" : "Sekarang"}</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.lotId}>
                  <td className="num">{n.depth}</td>
                  <td>
                    <Link className="mono" href={`/production/report/lot-card?q=${encodeURIComponent(n.lotNo)}`}>
                      {n.lotNo}
                    </Link>
                  </td>
                  <td>
                    <span className="idc">
                      <span className="lab">{n.itemLabel}</span>
                      <span className="nm">{n.itemName}</span>
                    </span>
                  </td>
                  <td>
                    {n.via.length ? (
                      <span className="dstack" style={{ gap: 2 }}>
                        {n.via.map((e, i) => (
                          <span key={i} className="d2">
                            <span className="mono">{e.sourceNo}</span> · {qty(e.qty)} {n.uom} · {money(e.value)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td>
                    {n.origin ? (
                      <span className="d2">
                        {n.origin.sourceNo ? <span className="mono">{n.origin.sourceNo}</span> : null}
                        {n.origin.supplier ? ` · ${n.origin.supplier}` : ""}
                      </span>
                    ) : n.now ? (
                      <span className="dstack" style={{ gap: 2 }}>
                        {n.now.production.map((p, i) => (
                          <span key={`p${i}`} className="d2">
                            Produksi · {p.stationLabel} · {qty(p.qty)} {n.uom}
                          </span>
                        ))}
                        {n.now.stock.map((s, i) => (
                          <span key={`s${i}`} className="d2">
                            Stok · {s.where} · {qty(s.qty)} {n.uom}
                          </span>
                        ))}
                        {n.now.delivered.map((d, i) => (
                          <span key={`d${i}`} className="d2">
                            Terkirim · <span className="mono">{d.noteNo}</span> {formatDate(d.date)} · {d.to} · {qty(d.qty)} {n.uom}
                          </span>
                        ))}
                        {!n.now.production.length && !n.now.stock.length && !n.now.delivered.length && <span className="dash">tidak tercatat di mana-mana</span>}
                      </span>
                    ) : (
                      dash
                    )}
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

/** Telusur: the start, where it came from, where it went (P171). */
export function TraceBody({ report }: { report: TraceReport }) {
  return (
    <>
      <TraceTable title={report.subject} lead={report.kind === "lot" ? "Lot yang ditelusuri, dan di mana ia sekarang." : "Setiap lot yang pernah dipegangnya, dan di mana lot itu sekarang."} nodes={report.start} dir="start" />
      <TraceTable title="Asal" lead="Mundur lewat setiap eksekusi sampai lot yang datang dari supplier." nodes={report.backward} dir="back" />
      <TraceTable title="Tujuan" lead="Maju lewat setiap eksekusi sampai barang jadi di stok dan customer yang menerimanya." nodes={report.forward} dir="fwd" />
      {report.truncated && (
        <div className="nbox warn slim" style={{ marginTop: 14 }}>
          <Icon name="warn" size={15} className="ni" />
          <div>
            <b>Penelusuran dipotong.</b> Terlalu banyak lot; telusuri dari lot yang lebih dekat ke ujung yang dicari.
          </div>
        </div>
      )}
    </>
  );
}

/** Rekap Produksi: per workstation and unit, in against out, the loss and the cost per unit (P171). */
export function RecapBody({ stations }: { stations: RecapStation[] }) {
  if (!stations.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="trend" size={20} />
        </div>
        <h4>Tidak ada eksekusi</h4>
        <p>Tidak ada Eksekusi Produksi yang diposting pada rentang dan filter ini.</p>
      </div>
    );
  }
  return (
    <>
      {stations.map((s) => (
        <div key={s.stationId} className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <span className="ci">
              <Icon name="gear" size={15} />
            </span>
            <div className="ct">
              <h3>
                <span className="lab">{s.stationLabel}</span> {s.stationName}
              </h3>
              <p>
                {s.runs} eksekusi · biaya standar {money(s.standard)}
              </p>
            </div>
          </div>
          <div className="tw">
            <table className="grid" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Satuan</th>
                  <th className="num" style={{ width: 130 }}>Input</th>
                  <th className="num" style={{ width: 130 }}>Output</th>
                  <th className="num" style={{ width: 120 }}>Susut</th>
                  <th className="num" style={{ width: 90 }}>%</th>
                  <th className="num" style={{ width: 150 }}>Nilai Input</th>
                  <th className="num" style={{ width: 150 }}>Nilai Output</th>
                  <th className="num" style={{ width: 120 }}>HPP Masuk</th>
                  <th className="num" style={{ width: 120 }}>HPP Keluar</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.uom}>
                    <td>
                      <span className="lab">{r.uom}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(r.inQty)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{qty(r.outQty)}</span>
                    </td>
                    <td className="num">{r.loss ? <span className={r.loss > 0 ? "mny" : "fulltag"}>{r.loss > 0 ? qty(r.loss) : `+${qty(-r.loss)}`}</span> : dash}</td>
                    <td className="num">{r.loss ? <span className="mny">{formatNumber(r.lossPct, 2)}%</span> : dash}</td>
                    <td className="num">
                      <span className="mny">{money(r.inValue)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(r.outValue)}</span>
                    </td>
                    <td className="num">{r.inValue ? <span className="mny">{formatPrice(r.inUnitCost)}</span> : dash}</td>
                    <td className="num">{r.outValue ? <span className="mny">{formatPrice(r.outUnitCost)}</span> : dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "0 14px 12px" }}>
            <span className="d2">
              Eksekusi:{" "}
              {s.executions.map((e, i) => (
                <span key={e.id}>
                  {i > 0 && " · "}
                  <Link className="mono" href={`/production/execution/${e.id}`} title={`${formatDate(e.date)} · ${e.kind}`}>
                    {e.no}
                  </Link>
                </span>
              ))}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}
