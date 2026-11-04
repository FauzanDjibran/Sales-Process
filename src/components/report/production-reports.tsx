import Link from "next/link";
import { Icon } from "@/components/icon";
import { MOVEMENT_LABEL, type LotCard, type TraceNode, type TraceReport, type WipBlock } from "@/lib/erp/production-report";
import { reportHref } from "@/lib/erp/reports";
import { formatDate, formatMoney, formatNumber, formatPrice } from "@/lib/format";

const qty = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const money = (n: number) => formatMoney(n, "IDR");

/** A figure that is nothing reads as a dash, like the other reports. */
const dash = <span className="dash">—</span>;

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

/** Saldo Produksi: a block per workstation, a row per bucket (R18). */
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
        <div key={b.stationId} className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <span className="ci">
              <Icon name="gear" size={15} />
            </span>
            <div className="ct">
              <h3>
                <span className="lab">{b.stationLabel}</span> {b.stationName}
              </h3>
              <p>{b.rows.length} lot</p>
            </div>
            <span className="mny">{money(b.value)}</span>
          </div>
          <div className="tw">
            <table className="grid" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Barang</th>
                  <th style={{ width: 200 }}>Lot</th>
                  <th className="num" style={{ width: 130 }}>Qty</th>
                  <th className="num" style={{ width: 150 }}>Nilai</th>
                  <th className="num" style={{ width: 130 }}>Per Unit</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.bucketId}>
                    <td>
                      <span className="idc">
                        <span className="lab">{r.itemLabel}</span>
                        <span className="nm">{r.itemName}</span>
                      </span>
                    </td>
                    <td>
                      <Link className="mono" href={lotHref(r.lotNo)}>
                        {r.lotNo}
                      </Link>
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
                <p>Setiap mutasi buku produksi atas lot ini, dengan saldo dan nilainya setelah itu, per workstation.</p>
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
                      <th>Workstation</th>
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
                        <td>{MOVEMENT_LABEL[m.movement] ?? m.movement}</td>
                        <td>
                          <span className="lab">{m.stationLabel}</span>
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
                      <th style={{ width: 190 }}>Dokumen</th>
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
                <th style={{ width: 200 }}>Lot</th>
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
                            <span className="mono">{e.sourceNo}</span> · {e.stationLabel} · {qty(e.qty)} {dir === "back" ? n.uom : ""} · {money(e.value)}
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
                          Produksi · {p.stationLabel} · {qty(p.qty)} {n.uom}
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
      <TraceTable title="Lot yang Ditelusuri" lead="Lot dengan nomor ini — satu per barang — dan di mana ia sekarang." nodes={report.start} dir="start" />
      <TraceTable title="Asal (Mundur)" lead="Lewat setiap eksekusi sampai lot yang masuk dari supplier atau injeksi." nodes={report.backward} dir="back" />
      <TraceTable title="Tujuan (Maju)" lead="Lewat setiap eksekusi sampai barang di workstation, di stok, atau terkirim ke customer." nodes={report.forward} dir="fwd" />
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
