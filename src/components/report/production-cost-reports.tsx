import Link from "next/link";
import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { documentHref } from "@/lib/erp/document-links";
import { COST_ROW_KIND_TEXT, type CostBalanceRow, type CostLedgerRow, type ElementInfo } from "@/lib/erp/production-cost";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * The bodies of Buku Biaya Produksi and Saldo Biaya Produksi (P150 M66) — the
 * cost ledger read for one month. The cost ledger is the source of truth
 * (M60); the GL is set beside it only as a check, and a difference is a
 * warning, never acted on (M67).
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
                {e?.name} · {e?.accountLabel} {e?.accountName} · {list.length} baris
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

export type GlBeside = { accountId: number; accountLabel: string; accountName: string; costLedger: number; gl: number };

export function CostBalanceBody({
  balances,
  elements,
  gl,
}: {
  balances: CostBalanceRow[];
  elements: Map<number, ElementInfo>;
  gl: GlBeside[];
}) {
  const rows = [...balances].sort((a, b) => (elements.get(a.elementId)?.label ?? "").localeCompare(elements.get(b.elementId)?.label ?? ""));
  const sum = (f: (r: CostBalanceRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const carried = (r: CostBalanceRow) => r.byKind.CarriedIn + r.byKind.CarriedOut;
  const differences = gl.filter((g) => Math.round(g.costLedger * 100) !== Math.round(g.gl * 100));

  return (
    <>
      <div className="cblock">
        <div className="cbh">
          <b>Per elemen</b>
          <span className="cbn">{rows.length} elemen dengan biaya pada bulan ini</span>
          <ReportSummary figures={[{ label: "Total Biaya", value: money(sum((r) => r.total)), key: true }]} />
        </div>
        <div className="tw">
          <table className="grid" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Elemen Biaya Produksi</th>
                <th style={{ width: 230 }}>Account</th>
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
                    <td>
                      <span className="idc">
                        <span className="lab">{e?.accountLabel}</span>
                        <span className="nm">{e?.accountName}</span>
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
                  <td colSpan={6} className="mut" style={{ textAlign: "center" }}>
                    Tidak ada biaya produksi pada bulan ini.
                  </td>
                </tr>
              )}
              {rows.length > 0 && (
                <tr className="totrow">
                  <td colSpan={2}>Total</td>
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

      <div className="cblock">
        <div className="cbh">
          <b>Dicocokkan dengan GL</b>
          <span className="cbn">Per account elemen: Buku Biaya Produksi di samping mutasi GL bulan ini (debit − kredit). Buku Biaya Produksi yang dipakai.</span>
        </div>
        {differences.length > 0 && (
          <div className="nbox warn slim">
            <span className="ni">
              <Icon name="warn" size={14} />
            </span>
            <div>
              <b>
                {differences.length} account berbeda dengan GL.
              </b>
              <p>
                Ada posting ke account elemen yang tidak lewat Tagihan Biaya Produksi (mis. journal manual), atau sebaliknya.
                Penutupan biaya tetap memakai Buku Biaya Produksi; selisih ini hanya untuk diperiksa.
              </p>
            </div>
          </div>
        )}
        <div className="tw">
          <table className="grid" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Account</th>
                <th className="num" style={{ width: 170 }}>
                  Buku Biaya Produksi
                </th>
                <th className="num" style={{ width: 170 }}>
                  GL
                </th>
                <th className="num" style={{ width: 150 }}>
                  Selisih
                </th>
              </tr>
            </thead>
            <tbody>
              {gl.map((g) => {
                const diff = g.costLedger - g.gl;
                return (
                  <tr key={g.accountId} style={{ cursor: "default" }}>
                    <td>
                      <span className="idc">
                        <span className="lab">{g.accountLabel}</span>
                        <span className="nm">{g.accountName}</span>
                      </span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(g.costLedger)}</span>
                    </td>
                    <td className="num">
                      <span className="mny">{money(g.gl)}</span>
                    </td>
                    <td className="num">
                      {Math.round(diff * 100) ? <span className="mny neg">{money(diff)}</span> : <span className="dash">—</span>}
                    </td>
                  </tr>
                );
              })}
              {gl.length === 0 && (
                <tr>
                  <td colSpan={4} className="mut" style={{ textAlign: "center" }}>
                    Belum ada Elemen Biaya Produksi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
