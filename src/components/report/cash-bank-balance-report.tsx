import Link from "next/link";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { formatDate } from "@/lib/format";
import type { BalanceReport } from "@/lib/erp/cash-bank";
import { reportHref } from "@/lib/erp/reports";

/**
 * Saldo Kas & Bank — opening, movement and closing for every resource.
 *
 * One section per currency, each totalled on its own. Currencies are never
 * added together at face value: USD 3.500 and Rp 45.000.000 are quantities of
 * different things, and a combined figure would be neither. The books do carry
 * a base measure of every movement, but it answers a different question — what
 * the currency cost — and the General Ledger is where that is read. This report
 * says what each account holds.
 *
 * The four figures are the columns, so this is the one report whose block
 * header carries no summary strip: the totals belong in the footer row, lined
 * up under the columns they total. A strip repeating them above would be the
 * same numbers twice.
 *
 * The type travels under the resource name rather than in a column of its
 * own. A fixed column to print one short word is exactly what pushes the
 * money columns off the right-hand edge.
 *
 * Every row drills through to that resource's `Buku Kas & Bank` for the same
 * period — a summary figure should always be one click from the rows that
 * produced it, which is what makes a summary checkable rather than merely
 * believable.
 */
export function CashBankBalanceReport({ report }: { report: BalanceReport }) {
  if (!report.groups.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="wallet" size={20} />
        </div>
        <h4>Belum ada resource kas atau bank</h4>
        <p>
          Laporan ini merangkum buku setiap resource. Daftarkan Cash &amp; Bank
          di modul Master terlebih dahulu.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rhead">
        <span className="count">
          <b>{report.resources}</b> resource · {formatDate(report.range.from)} –{" "}
          {formatDate(report.range.to)}
        </span>
      </div>

      {report.groups.map((g) => {
        return (
          <div className="cblock" key={g.currencyId}>
            <div className="cbh">
              <b>{g.currencyLabel}</b>
              <span className="cbn">{g.rows.length} resource</span>
            </div>

            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th className="num" style={{ width: 130 }}>
                      Saldo Awal
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Penerimaan
                    </th>
                    <th className="num" style={{ width: 130 }}>
                      Pengeluaran
                    </th>
                    <th className="num" style={{ width: 140 }}>
                      Saldo Akhir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.cashBankId} style={{ cursor: "default" }}>
                      <td className="pri">
                        <Link
                          href={reportHref("cash-bank-ledger", {
                            cashBank: r.cashBankId,
                            from: report.range.from,
                            to: report.range.to,
                          })}
                          title="Buka Buku Kas & Bank untuk periode ini"
                        >
                          <span className="idc">
                            <span className="lab">{r.label}</span>
                            <span className="nm">{r.name}</span>
                            {!r.active && (
                              <span className="bdg s-bad">Non Aktif</span>
                            )}
                          </span>
                        </Link>
                        <span className="rsub">
                          {r.type}
                        </span>
                      </td>
                      <td className="num">
                        <Amount value={r.opening} currency={g.currencyLabel} nil="dash" ledger />
                      </td>
                      <td className="num">
                        <Amount value={r.totalIn} currency={g.currencyLabel} nil="dash" ledger />
                      </td>
                      <td className="num">
                        <Amount value={r.totalOut} currency={g.currencyLabel} nil="dash" ledger />
                      </td>
                      <td className="num">
                        <Amount value={r.closing} currency={g.currencyLabel} nil="dash" ledger />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="totrow">
                    <td style={{ textAlign: "right" }}>
                      Total {g.currencyLabel}
                    </td>
                    <td className="num"><Amount value={g.opening} currency={g.currencyLabel} nil="dash" ledger /></td>
                    <td className="num"><Amount value={g.totalIn} currency={g.currencyLabel} nil="dash" ledger /></td>
                    <td className="num"><Amount value={g.totalOut} currency={g.currencyLabel} nil="dash" ledger /></td>
                    <td className="num">
                      <b><Amount value={g.closing} currency={g.currencyLabel} nil="dash" ledger /></b>
                    </td>
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
