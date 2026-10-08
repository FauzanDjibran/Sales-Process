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
 */

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
}: {
  rows: CostLedgerRow[];
  elements: Map<number, ElementInfo>;
  docs: Map<number, CostSourceDoc>;
}) {
  const byElement = new Map<number, CostLedgerRow[]>();
  for (const r of rows) byElement.set(r.elementId, [...(byElement.get(r.elementId) ?? []), r]);
  const order = [...byElement.keys()].sort((a, b) => (elements.get(a)?.label ?? "").localeCompare(elements.get(b)?.label ?? ""));
  const grand = rows.reduce((a, r) => a + r.amount, 0);

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
          <ReportSummary figures={[{ label: "Total Biaya", value: money(grand), key: true }]} />
        </div>
      </div>
      {order.map((id) => {
        const e = elements.get(id);
        const list = byElement.get(id)!;
        const total = list.reduce((a, r) => a + r.amount, 0);
        return (
          <div className="cblock" key={id}>
            <div className="cbh">
              <b>{e?.label ?? `#${id}`}</b>
              <span className="cbn">
                {e?.name} · {list.length} baris
              </span>
              <ReportSummary figures={[{ label: "Total", value: money(total), key: true }]} />
            </div>
            <div className="tw">
              <table className="grid" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ width: 92 }}>Tanggal</th>
                    <th style={{ width: 210 }}>Entri</th>
                    <th style={{ width: 170 }}>Jenis</th>
                    <th>Keterangan</th>
                    <th className="num" style={{ width: 150 }}>
                      Jumlah
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
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
                      <td>{COST_ROW_KIND_TEXT[r.kind]}</td>
                      <td className="mut">{r.note ?? <span className="dash">—</span>}</td>
                      <td className="num">
                        <span className={`mny${r.amount < 0 ? " neg" : ""}`}>{money(r.amount)}</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="totrow">
                    <td colSpan={4}>Total {e?.label}</td>
                    <td className="num">{money(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ------------------------------------------------------ Saldo Biaya Produksi

export function CostBalanceBody({
  balances,
  elements,
}: {
  balances: CostBalanceRow[];
  elements: Map<number, ElementInfo>;
}) {
  const rows = [...balances].sort((a, b) => (elements.get(a.elementId)?.label ?? "").localeCompare(elements.get(b.elementId)?.label ?? ""));
  const sum = (f: (r: CostBalanceRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const carried = (r: CostBalanceRow) => r.byKind.CarriedIn + r.byKind.CarriedOut;

  return (
    <>
      <div className="cblock">
        <div className="cbh">
          <b>Per elemen</b>
          <span className="cbn">{rows.length} elemen dengan biaya pada bulan ini</span>
          <ReportSummary figures={[{ label: "Total Biaya", value: money(sum((r) => r.total)), key: true }]} />
        </div>
        <div className="tw">
          <table className="grid" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Elemen Biaya Produksi</th>
                <th className="num" style={{ width: 140 }}>
                  Masuk
                </th>
                <th className="num" style={{ width: 140 }}>
                  Dibebankan
                </th>
                <th className="num" style={{ width: 140 }}>
                  Dibawa
                </th>
                <th className="num" style={{ width: 150 }}>
                  Saldo
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
                      <span className="mny">{money(r.byKind.In)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(r.byKind.Absorbed + r.byKind.ExpensedToPL)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(carried(r))}</span>
                    </td>
                    <td className="num">
                      <span className="mny">
                        <b>{money(r.total)}</b>
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
                  <td className="num">{money(sum((r) => r.byKind.In))}</td>
                  <td className="num">{money(sum((r) => r.byKind.Absorbed + r.byKind.ExpensedToPL))}</td>
                  <td className="num">{money(sum(carried))}</td>
                  <td className="num">{money(sum((r) => r.total))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </>
  );
}
