import Link from "next/link";
import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { documentHref } from "@/lib/erp/document-links";
import type { CostCenterBlock, CostCenterFigures } from "@/lib/erp/cost-center";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * *Laporan Cost Center* (P154, M90) — how much cost sits in each Cost Center
 * for one month, read from journal lines only. The shape of the Buku Kas &
 * Bank and the General Ledger: per Cost Center its Saldo Awal · Debit · Kredit
 * · Saldo Akhir (*Saldo*), then per account the same figures and the journal
 * lines behind them (*Buku*). Saldo Awal counts from the fiscal year's start.
 */

const money = (n: number) => formatMoney(n, "IDR");

export type SourceDocName = { table: string | null; name: string };

const figures = (f: CostCenterFigures, key = true) => [
  { label: "Saldo Awal", value: money(f.opening), zero: !f.opening },
  { label: "Debit", value: money(f.debit), zero: !f.debit },
  { label: "Kredit", value: money(f.credit), zero: !f.credit },
  { label: "Saldo Akhir", value: money(f.closing), key, negative: f.closing < 0 },
];

export function CostCenterReportBody({
  blocks,
  docs,
  range,
}: {
  blocks: CostCenterBlock[];
  docs: Map<number, SourceDocName>;
  range: { from: string; to: string };
}) {
  if (!blocks.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="book" size={20} />
        </div>
        <h4>Belum ada Cost Center</h4>
        <p>Buat Cost Center di Master › Referensi.</p>
      </div>
    );
  }

  return (
    <>
      {blocks.map((c) => (
        <div key={c.costCenterId}>
          <div className="cblock">
            <div className="cbh">
              <b>{c.label}</b>
              <span className="cbn">
                {c.name} · {c.accounts.length} account
              </span>
              <ReportSummary figures={figures(c)} />
            </div>
          </div>
          {c.accounts.length === 0 && (
            <p className="mut" style={{ margin: "0 0 14px" }}>
              Tidak ada biaya pada Cost Center ini sampai {formatDate(range.to)}.
            </p>
          )}
          {c.accounts.map((a) => (
            <div className="cblock" key={a.accountId}>
              <div className="cbh">
                <b>{a.accountLabel}</b>
                <span className="cbn">
                  {a.accountName} · {a.lines.length} baris
                </span>
                <ReportSummary figures={figures(a, false)} />
              </div>
              <div className="tw">
                <table className="grid" style={{ minWidth: 1020 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 92 }}>Tanggal</th>
                      <th style={{ width: 160 }}>Journal</th>
                      <th style={{ width: 150 }}>Partner</th>
                      <th style={{ minWidth: 220 }}>Keterangan</th>
                      <th className="num" style={{ width: 128 }}>
                        Debit
                      </th>
                      <th className="num" style={{ width: 128 }}>
                        Kredit
                      </th>
                      <th className="num" style={{ width: 140 }}>
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="totrow">
                      <td colSpan={4}>Saldo awal per {formatDate(range.from)}</td>
                      <td className="num mut">—</td>
                      <td className="num mut">—</td>
                      <td className="num">{money(a.opening)}</td>
                    </tr>
                    {a.lines.map((l, i) => {
                      const running = a.opening + a.lines.slice(0, i + 1).reduce((x, y) => x + y.debit - y.credit, 0);
                      const doc = l.sourceDocTypeId ? docs.get(l.sourceDocTypeId) : undefined;
                      const href = documentHref(doc?.table ?? null, l.sourceDocId);
                      return (
                        <tr key={l.id} style={{ cursor: "default" }}>
                          <td className="mono mut" style={{ fontSize: "11.5px" }}>
                            {formatDate(l.date)}
                          </td>
                          <td>
                            <Link className="lab" href={`/accounting/journal/${l.journalId}`}>
                              {l.journalNo}
                            </Link>
                            {href && (
                              <Link className="rsub" href={href} title={`Buka ${doc?.name ?? "dokumen"}`}>
                                {doc?.name}
                              </Link>
                            )}
                          </td>
                          <td>
                            {l.partnerLabel ? (
                              <span className="idc">
                                <span className="lab">{l.partnerLabel}</span>
                                <span className="nm">{l.partnerName}</span>
                              </span>
                            ) : (
                              <span className="dash">—</span>
                            )}
                          </td>
                          <td className="pri wrapok">{l.description}</td>
                          <td className="num">{l.debit ? <span className="mny">{money(l.debit)}</span> : <span className="dash">–</span>}</td>
                          <td className="num">{l.credit ? <span className="mny">{money(l.credit)}</span> : <span className="dash">–</span>}</td>
                          <td className="num">
                            <span className={`mny${running < 0 ? " neg" : ""}`}>{money(running)}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {a.lines.length === 0 && (
                      <tr>
                        <td colSpan={7} className="mut" style={{ textAlign: "center" }}>
                          Tidak ada mutasi pada bulan ini. Saldo akhir sama dengan saldo awal.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="totrow">
                      <td colSpan={4}>Saldo akhir per {formatDate(range.to)}</td>
                      <td className="num">{money(a.debit)}</td>
                      <td className="num">{money(a.credit)}</td>
                      <td className="num">{money(a.closing)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
