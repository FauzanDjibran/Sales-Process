import Link from "next/link";
import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { documentHref } from "@/lib/erp/document-links";
import { COST_ROW_KIND_TEXT, type CostBalanceRow, type CostLedgerRow, type ElementInfo } from "@/lib/erp/production-cost";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * The bodies of Buku Biaya Produksi and Saldo Biaya Produksi (P150 M66) — the
 * cost ledger read for one month. The cost ledger stands on its own, as the
 * Cash Bank Book and the stock books do (P152): it is what the month-end
 * close reads (M60), so the reports show its figures by Elemen Biaya Produksi
 * and nothing from the GL — no account and no comparison.
 *
 * Both read a month as Saldo Awal → Masuk → Keluar → Saldo Akhir, like the
 * Buku Kas & Bank and the Kartu Stok (P153): **Saldo Awal** is the cost carried
 * in from the month before (*CarriedIn*); **Masuk** the cost recorded (*In*);
 * **Keluar** what the month-end close takes out — to the products made
 * (*Absorbed*), to Laba Rugi (*ExpensedToPL*) or on to the next month
 * (*CarriedOut*). A costed month ends at 0.
 */

/** How a row reads in a month: opening, in or out (P153). */
const flow = (r: CostLedgerRow) => (r.kind === "CarriedIn" ? "opening" : r.amount >= 0 ? "in" : "out");

type Totals = { opening: number; in: number; out: number; closing: number };

function totalsOf(rows: CostLedgerRow[]): Totals {
  const t = { opening: 0, in: 0, out: 0, closing: 0 };
  for (const r of rows) {
    const f = flow(r);
    if (f === "opening") t.opening += r.amount;
    else if (f === "in") t.in += r.amount;
    else t.out -= r.amount;
  }
  t.closing = t.opening + t.in - t.out;
  return t;
}

const figures = (t: Totals) => [
  { label: "Saldo Awal", value: money(t.opening), zero: !t.opening },
  { label: "Masuk", value: money(t.in), zero: !t.in },
  { label: "Keluar", value: money(t.out), zero: !t.out },
  { label: "Saldo Akhir", value: money(t.closing), key: true, negative: t.closing < 0 },
];


const money = (n: number) => formatMoney(n, "IDR");

export type CostSourceDoc = { table: string | null; name: string };

function SourceLink({ row, docs }: { row: CostLedgerRow; docs: Map<number, CostSourceDoc> }) {
  const doc = docs.get(row.source.docTypeId);
  const href = documentHref(doc?.table ?? null, row.source.docId);
  return href ? (
    <Link className="rsub" href={href} title={`Buka ${doc?.name ?? "dokumen"}`}>
      {row.source.no}
    </Link>
  ) : (
    <span className="rsub">{row.source.no}</span>
  );
}

// ------------------------------------------------------ Buku Biaya Produksi

export function CostLedgerBody({
  rows,
  elements,
  docs,
  range,
}: {
  rows: CostLedgerRow[];
  elements: Map<number, ElementInfo>;
  docs: Map<number, CostSourceDoc>;
  range: { from: string; to: string };
}) {
  const byElement = new Map<number, CostLedgerRow[]>();
  for (const r of rows) byElement.set(r.elementId, [...(byElement.get(r.elementId) ?? []), r]);
  const order = [...byElement.keys()].sort((a, b) => (elements.get(a)?.label ?? "").localeCompare(elements.get(b)?.label ?? ""));

  if (!rows.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="book" size={20} />
        </div>
        <h4>Tidak ada biaya produksi pada bulan ini</h4>
        <p>Biaya masuk ke buku ini saat Tagihan Biaya Produksi diposting.</p>
      </div>
    );
  }

  return (
    <>
      <div className="cblock">
        <div className="cbh">
          <b>Seluruh elemen</b>
          <span className="cbn">
            {order.length} elemen · {rows.length} baris
          </span>
          <ReportSummary figures={figures(totalsOf(rows))} />
        </div>
      </div>
      {order.map((id) => {
        const e = elements.get(id);
        const list = byElement.get(id)!;
        const t = totalsOf(list);
        const opening = list.filter((r) => flow(r) === "opening");
        const moves = list.filter((r) => flow(r) !== "opening");
        let running = t.opening;
        return (
          <div className="cblock" key={id}>
            <div className="cbh">
              <b>{e?.label ?? `#${id}`}</b>
              <span className="cbn">
                {e?.name} · {moves.length} mutasi
              </span>
              <ReportSummary figures={figures(t)} />
            </div>
            <div className="tw">
              <table className="grid" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ width: 92 }}>Tanggal</th>
                    <th style={{ width: 190 }}>Entri</th>
                    <th>Keterangan</th>
                    <th className="num" style={{ width: 140 }}>
                      Masuk
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Keluar
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Saldo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="totrow">
                    <td colSpan={3}>
                      Saldo awal per {formatDate(range.from)}
                      {opening.map((r) => (
                        <span key={r.id} className="mut" style={{ marginLeft: 8, fontWeight: 400 }}>
                          · dibawa dari bulan lalu, <SourceLink row={r} docs={docs} />
                        </span>
                      ))}
                    </td>
                    <td className="num mut">—</td>
                    <td className="num mut">—</td>
                    <td className="num">{money(t.opening)}</td>
                  </tr>
                  {moves.map((r) => {
                    const inn = flow(r) === "in";
                    running += r.amount;
                    return (
                      <tr key={r.id} style={{ cursor: "default" }}>
                        <td className="mono mut" style={{ fontSize: "11.5px" }}>
                          {formatDate(r.date)}
                        </td>
                        <td>
                          <span className="lab">
                            {r.ledgerNo}·{r.lineNo}
                          </span>
                          <SourceLink row={r} docs={docs} />
                        </td>
                        <td className="pri wrapok">
                          {r.kind !== "In" && (
                            <span className="bdg s-info" style={{ marginRight: 6 }}>
                              {COST_ROW_KIND_TEXT[r.kind]}
                            </span>
                          )}
                          {r.note ?? <span className="dash">—</span>}
                        </td>
                        <td className="num">{inn ? <span className="mny in">{money(r.amount)}</span> : <span className="dash">–</span>}</td>
                        <td className="num">{!inn ? <span className="mny">{money(-r.amount)}</span> : <span className="dash">–</span>}</td>
                        <td className="num">
                          <span className={`mny${running < 0 ? " neg" : ""}`}>{money(running)}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {moves.length === 0 && (
                    <tr>
                      <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                        Tidak ada mutasi pada bulan ini. Saldo akhir sama dengan saldo awal.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td colSpan={3}>Saldo akhir per {formatDate(range.to)}</td>
                    <td className="num">{money(t.in)}</td>
                    <td className="num">{money(t.out)}</td>
                    <td className="num">{money(t.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------ Saldo Biaya Produksi

export function CostBalanceBody({ balances, elements }: { balances: CostBalanceRow[]; elements: Map<number, ElementInfo> }) {
  const rows = [...balances]
    .sort((a, b) => (elements.get(a.elementId)?.label ?? "").localeCompare(elements.get(b.elementId)?.label ?? ""))
    .map((r) => {
      const opening = r.byKind.CarriedIn;
      const inn = r.byKind.In;
      const out = 0 - (r.byKind.Absorbed + r.byKind.ExpensedToPL + r.byKind.CarriedOut); // never −0
      return { elementId: r.elementId, opening, in: inn, out, closing: r.total };
    });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const total: Totals = { opening: sum((r) => r.opening), in: sum((r) => r.in), out: sum((r) => r.out), closing: sum((r) => r.closing) };

  return (
    <div className="cblock">
      <div className="cbh">
        <b>Per elemen</b>
        <span className="cbn">{rows.length} elemen dengan biaya pada bulan ini</span>
        <ReportSummary figures={figures(total)} />
      </div>
      <div className="tw">
        <table className="grid" style={{ minWidth: 780 }}>
          <thead>
            <tr>
              <th>Elemen Biaya Produksi</th>
              <th className="num" style={{ width: 140 }}>
                Saldo Awal
              </th>
              <th className="num" style={{ width: 140 }}>
                Masuk
              </th>
              <th className="num" style={{ width: 140 }}>
                Keluar
              </th>
              <th className="num" style={{ width: 150 }}>
                Saldo Akhir
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = elements.get(r.elementId);
              return (
                <tr key={r.elementId} style={{ cursor: "default" }}>
                  <td>
                    <span className="idc">
                      <span className="lab">{e?.label}</span>
                      <span className="nm">{e?.name}</span>
                    </span>
                  </td>
                  <td className="num">
                    <span className="mny">{money(r.opening)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{money(r.in)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{money(r.out)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">
                      <b>{money(r.closing)}</b>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="mut" style={{ textAlign: "center" }}>
                  Tidak ada biaya produksi pada bulan ini.
                </td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="totrow">
                <td>Total</td>
                <td className="num">{money(total.opening)}</td>
                <td className="num">{money(total.in)}</td>
                <td className="num">{money(total.out)}</td>
                <td className="num">{money(total.closing)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
