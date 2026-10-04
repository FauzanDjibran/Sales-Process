import { Icon } from "@/components/icon";
import { DocLink } from "@/components/report/customer-advance-report";
import { AGING_BUCKETS, agingBucket, daysOverdue, type AgingBucket } from "@/lib/erp/ar-aging";
import type { ArItemRow } from "@/lib/erp/ar-item";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Umur Piutang (P75) — open Invoice items per customer, spread over how late
 * they are at the date asked about, beside the Uang Muka each customer still
 * holds and the net position. Invoices are born when an Invoice Penjualan posts;
 * until then only the Uang Muka column has figures.
 */
const money = (n: number) => formatMoney(n, "IDR");
const cell = (n: number) => (n ? <span className="mny">{money(n)}</span> : <span className="dash">–</span>);

export function ArAgingReport({ invoices, advances, asOf }: { invoices: ArItemRow[]; advances: ArItemRow[]; asOf: string }) {
  const partners = [...new Map([...invoices, ...advances].map((r) => [r.partnerId, r])).values()].sort((a, b) =>
    a.partnerLabel.localeCompare(b.partnerLabel)
  );
  if (!partners.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="clock" size={20} />
        </div>
        <h4>Tidak ada piutang terbuka</h4>
        <p>Pada tanggal ini tidak ada invoice yang belum lunas dan tidak ada uang muka customer yang belum dipakai.</p>
      </div>
    );
  }
  const bucketOf = (r: ArItemRow) => agingBucket(r.dueDate ?? r.date, asOf);
  const sumBy = (rows: ArItemRow[], b?: AgingBucket) => rows.filter((r) => !b || bucketOf(r) === b).reduce((a, r) => a + r.open, 0);
  const totals = {
    buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, sumBy(invoices, b.key)])) as Record<AgingBucket, number>,
    invoice: sumBy(invoices),
    advance: advances.reduce((a, r) => a + r.open, 0),
  };

  return (
    <>
      <div className="tw">
        <table className="grid">
          <thead>
            <tr>
              <th>Customer</th>
              {AGING_BUCKETS.map((b) => (
                <th key={b.key} className="num" style={{ width: 118 }}>{b.label}</th>
              ))}
              <th className="num" style={{ width: 130 }}>Total Piutang</th>
              <th className="num" style={{ width: 124 }}>Uang Muka</th>
              <th className="num" style={{ width: 130 }}>Posisi Bersih</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => {
              const inv = invoices.filter((r) => r.partnerId === p.partnerId);
              const adv = advances.filter((r) => r.partnerId === p.partnerId).reduce((a, r) => a + r.open, 0);
              const total = sumBy(inv);
              return (
                <tr key={p.partnerId} style={{ cursor: "default" }}>
                  <td>
                    <span className="idc">
                      <span className="lab">{p.partnerLabel}</span>
                      <span className="nm">{p.partnerName}</span>
                    </span>
                  </td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b.key} className="num">{cell(sumBy(inv, b.key))}</td>
                  ))}
                  <td className="num">{cell(total)}</td>
                  <td className="num">{adv ? <span className="mny">−{money(adv)}</span> : <span className="dash">–</span>}</td>
                  <td className="num"><b className="mny">{money(total - adv)}</b></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="totrow">
              <td>Total</td>
              {AGING_BUCKETS.map((b) => (
                <td key={b.key} className="num">{cell(totals.buckets[b.key])}</td>
              ))}
              <td className="num">{cell(totals.invoice)}</td>
              <td className="num">{totals.advance ? <span className="mny">−{money(totals.advance)}</span> : <span className="dash">–</span>}</td>
              <td className="num"><b>{money(totals.invoice - totals.advance)}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h4 style={{ margin: "18px 0 8px", fontSize: 12.5 }}>Rincian Invoice Terbuka</h4>
      {invoices.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Invoice</th>
                <th>Customer</th>
                <th style={{ width: 96 }}>Tanggal</th>
                <th style={{ width: 106 }}>Jatuh Tempo</th>
                <th className="num" style={{ width: 90 }}>Umur</th>
                <th style={{ width: 130 }}>Kelompok</th>
                <th className="num" style={{ width: 130 }}>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((r) => {
                const due = r.dueDate ?? r.date;
                const d = daysOverdue(due, asOf);
                return (
                  <tr key={r.id} style={{ cursor: "default" }}>
                    <td><DocLink table={r.sourceTable} id={r.sourceId} no={r.sourceNo} /></td>
                    <td>{r.partnerName}</td>
                    <td className="mono mut">{formatDate(r.date)}</td>
                    <td className="mono">{formatDate(due)}</td>
                    <td className="num">{d > 0 ? `${d} hari` : "—"}</td>
                    <td>{AGING_BUCKETS.find((b) => b.key === bucketOf(r))?.label}</td>
                    <td className="num"><b className="mny">{money(r.open)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fnote">
          Belum ada invoice terbuka pada tanggal ini. Invoice terbentuk saat Invoice Penjualan diposting.
        </p>
      )}
    </>
  );
}
