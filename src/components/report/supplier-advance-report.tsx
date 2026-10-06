import Link from "next/link";
import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { documentHref } from "@/lib/erp/document-links";
import type { ApItemRow } from "@/lib/erp/ap-item";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Uang Muka Supplier (P75) — every advance received and not yet used by an
 * invoice, one block per supplier, at the date asked about. Amounts are the
 * DPP part (P73), which is what the Uang Muka Pembelian account holds, so each
 * supplier's open total is checked against that account's balance for them.
 */
export type SupplierAdvanceReconciliation =
  | { ok: true; accountLabel: string; accountName: string; byPartner: Record<number, number> }
  | { ok: false; missing: string };

const money = (n: number) => formatMoney(n, "IDR");

export function SupplierAdvanceReport({
  rows,
  gl,
  orderNos,
}: {
  rows: ApItemRow[];
  gl: SupplierAdvanceReconciliation;
  /** Purchase Order numbers by id, composed by the page (the order is another module's). */
  orderNos: Record<number, string>;
}) {
  if (!rows.length) {
    return (
      <div className="empty sm">
        <div className="ic">
          <Icon name="wallet" size={20} />
        </div>
        <h4>Tidak ada uang muka terbuka</h4>
        <p>Pada tanggal ini tidak ada uang muka ke supplier yang sudah dibayar dan belum dipakai invoice.</p>
      </div>
    );
  }
  // One group per supplier, in label order — not in the order their first item happens to be read.
  const partners = [...new Map(rows.map((r) => [r.partnerId, r])).values()].sort((a, b) => a.partnerLabel.localeCompare(b.partnerLabel));
  const grand = rows.reduce((a, r) => a + r.open, 0);
  const glGrand = gl.ok ? partners.reduce((a, p) => a + (gl.byPartner[p.partnerId] ?? 0), 0) : 0;

  return (
    <>
      {partners.map((p) => {
        const mine = rows.filter((r) => r.partnerId === p.partnerId);
        const open = mine.reduce((a, r) => a + r.open, 0);
        const received = mine.reduce((a, r) => a + r.original, 0);
        const used = mine.reduce((a, r) => a + r.settled, 0);
        const glBal = gl.ok ? gl.byPartner[p.partnerId] ?? 0 : null;
        const off = glBal !== null && Math.round(glBal * 100) !== Math.round(open * 100);
        return (
          <div className="cblock" key={p.partnerId}>
            <div className="cbh">
              <b>{p.partnerLabel}</b>
              <span className="cbn">
                {p.partnerName} · {mine.length} uang muka
              </span>
              <ReportSummary
                figures={[
                  { label: "Dibayar", value: money(received) },
                  { label: "Terpakai", value: money(used), zero: !used },
                  { label: "Sisa", value: money(open), key: true },
                ]}
              />
            </div>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>Tanggal</th>
                    <th style={{ width: 150 }}>AR Item</th>
                    <th style={{ width: 150 }}>Tagihan</th>
                    <th style={{ width: 150 }}>Penerimaan</th>
                    <th>Purchase Order</th>
                    <th className="num" style={{ width: 130 }}>Dibayar (DPP)</th>
                    <th className="num" style={{ width: 130 }}>Terpakai</th>
                    <th className="num" style={{ width: 130 }}>Sisa</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r) => (
                    <tr key={r.id} style={{ cursor: "default" }}>
                      <td className="mono mut" style={{ fontSize: "11.5px" }}>{formatDate(r.date)}</td>
                      <td>
                        <span className="lab">{r.apItemNo}</span>
                      </td>
                      <td>
                        <DocLink table={r.sourceTable} id={r.sourceId} no={r.sourceNo} />
                      </td>
                      <td>
                        <DocLink table={r.createdByTable} id={r.createdById} no={r.createdByNo} />
                      </td>
                      <td>
                        <DocLink table={r.orderId ? "pur_order" : null} id={r.orderId} no={r.orderId ? (orderNos[r.orderId] ?? null) : null} />
                      </td>
                      <td className="num"><span className="mny">{money(r.original)}</span></td>
                      <td className="num">{r.settled ? <span className="mny">{money(r.settled)}</span> : <span className="dash">–</span>}</td>
                      <td className="num"><b className="mny">{money(r.open)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {off && (
              <div className="nbox warn slim">
                <span className="ni"><Icon name="warn" size={14} /></span>
                <div>
                  <b>Tidak cocok dengan account {gl.ok ? gl.accountLabel : ""}: saldo supplier ini di General Ledger {money(glBal ?? 0)}.</b>
                  <p>Selisih {money((glBal ?? 0) - open)} — periksa journal manual pada account Uang Muka Pembelian untuk supplier ini.</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="cblock">
        <div className="cbh">
          <b>Total</b>
          <span className="cbn">{partners.length} supplier</span>
          <ReportSummary
            figures={[
              ...(gl.ok ? [{ label: `GL ${gl.accountLabel}`, value: money(glGrand) }] : []),
              { label: "Sisa Uang Muka", value: money(grand), key: true },
            ]}
          />
        </div>
      </div>
      {!gl.ok && (
        <div className="nbox warn slim">
          <span className="ni"><Icon name="warn" size={14} /></span>
          <div>
            <b>Tidak dapat dicocokkan dengan General Ledger.</b>
            <p>{gl.missing}</p>
          </div>
        </div>
      )}
    </>
  );
}

/** A document number, linked to its page where it has one. */
export function DocLink({ table, id, no }: { table: string | null; id: number | null; no: string | null }) {
  if (!no) return <span className="dash">—</span>;
  const href = documentHref(table, id);
  return href ? (
    <Link className="lab" href={href}>
      {no}
    </Link>
  ) : (
    <span className="lab">{no}</span>
  );
}
