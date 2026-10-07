import Link from "next/link";
import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { documentHref } from "@/lib/erp/document-links";
import type {
  StockSourceRef,
  ValuationLedgerReport,
  ValuationRow,
} from "@/lib/erp/stock-report";
import { formatDate, formatMoney, formatNumber, formatPrice } from "@/lib/format";

/**
 * The bodies of the two valuation reports (P120); Kartu Stok and Saldo Stok,
 * grouped per item or per warehouse, are in `stock-card-reports.tsx`. A card is
 * read like a book — opening carried in, rows oldest first, closing struck at
 * the foot — and a balance like a matrix over its subjects. Quantities are in
 * each item's base unit; value is whole rupiah.
 */

const qty = (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 4);
const money = (n: number) => formatMoney(n, "IDR");

function Source({ s }: { s: StockSourceRef }) {
  const href = documentHref(s.table, s.id);
  return href ? (
    <Link className="rsub" href={href} title={`Buka ${s.docName}`}>
      {s.no}
    </Link>
  ) : (
    <span className="rsub" title={s.docName}>
      {s.no}
    </span>
  );
}

export function Mismatch({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="nbox warn slim">
      <span className="ni">
        <Icon name="warn" size={14} />
      </span>
      <div>
        <b>Saldo tersimpan tidak cocok dengan jumlah mutasi.</b>
        <p>Saldo stok yang tersimpan berbeda dari penjumlahan buku-nya. Angka di atas dibaca dari buku; selisih ini perlu diperiksa.</p>
      </div>
    </div>
  );
}

// --------------------------------------------- Kartu Nilai Persediaan

export function ValuationLedgerBody({ report }: { report: ValuationLedgerReport }) {
  return (
    <>
      <div className="cblock">
        <div className="cbh">
          <b>{report.item.label}</b>
          <span className="cbn">
            {report.item.name} · seluruh gudang · {report.entries.length} mutasi · {report.item.uomLabel}
          </span>
          <ReportSummary
            figures={[
              { label: "Nilai Awal", value: money(report.openingValue), zero: !report.openingValue },
              { label: "Masuk", value: money(report.valueIn), zero: !report.valueIn },
              { label: "Keluar", value: money(report.valueOut), zero: !report.valueOut },
              { label: "Nilai Akhir", value: money(report.closingValue), key: true },
            ]}
          />
        </div>
        <div className="tw">
          <table className="grid" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 88 }}>Tanggal</th>
                <th>Entri</th>
                <th className="num" style={{ width: 80 }}>Qty</th>
                <th className="num" style={{ width: 110 }}>Harga Satuan</th>
                <th className="num" style={{ width: 125 }}>Nilai</th>
                <th className="num" style={{ width: 90 }}>Saldo Qty</th>
                <th className="num" style={{ width: 135 }}>Saldo Nilai</th>
                <th className="num" style={{ width: 105 }}>Rata-rata</th>
              </tr>
            </thead>
            <tbody>
              <tr className="totrow">
                <td colSpan={5}>Saldo awal per {formatDate(report.range.from)}</td>
                <td className="num">{qty(report.openingQty)}</td>
                <td className="num">{money(report.openingValue)}</td>
                <td className="num">{formatPrice(report.openingQty > 0 ? Math.round((report.openingValue / report.openingQty) * 1e6) / 1e6 : 0)}</td>
              </tr>
              {report.entries.map((e) => (
                <tr key={e.id} style={{ cursor: "default" }}>
                  <td className="mono mut" style={{ fontSize: "11.5px" }}>
                    {formatDate(e.date)}
                  </td>
                  <td>
                    <span className="lab">
                      {e.ledgerNo}·{e.lineNo}
                    </span>
                    <Source s={e.source} />
                  </td>
                  <td className="num">
                    <span className={`mny${e.qtyChange > 0 ? " in" : ""}`}>{qty(e.qtyChange)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{formatPrice(e.unitCost)}</span>
                  </td>
                  <td className="num">
                    <span className={`mny${e.valueChange > 0 ? " in" : ""}`}>{money(e.valueChange)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{qty(e.qtyBalance)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{money(e.valueBalance)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{formatPrice(e.average)}</span>
                  </td>
                </tr>
              ))}
              {report.entries.length === 0 && (
                <tr>
                  <td colSpan={8} className="mut" style={{ textAlign: "center" }}>
                    Tidak ada mutasi pada rentang tanggal ini. Saldo akhir sama dengan saldo awal.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="totrow">
                <td colSpan={5}>Saldo akhir per {formatDate(report.range.to)}</td>
                <td className="num">
                  <b>{qty(report.closingQty)}</b>
                </td>
                <td className="num">
                  <b>{money(report.closingValue)}</b>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <Mismatch show={!report.reconciles} />
    </>
  );
}

// ------------------------------------------------------ Nilai Persediaan

export type InventoryGl = { ok: true; accountLabel: string; accountName: string; balance: number } | { ok: false; missing: string };

export function ValuationBody({ rows, gl, reconciles }: { rows: ValuationRow[]; gl: InventoryGl; reconciles: boolean }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <>
      <div className="cblock">
        <div className="cbh">
          <b>Nilai Persediaan</b>
          <span className="cbn">{rows.length} barang · rata-rata bergerak</span>
          <ReportSummary
            figures={[
              { label: "Total Nilai", value: money(total), key: true },
              ...(gl.ok
                ? [
                    { label: `Buku Besar ${gl.accountLabel}`, value: money(gl.balance) },
                    { label: "Selisih", value: money(total - gl.balance), zero: total === gl.balance, negative: total !== gl.balance },
                  ]
                : []),
            ]}
          />
        </div>
        <div className="tw">
          <table className="grid" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Barang</th>
                <th style={{ width: 80 }}>Satuan</th>
                <th className="num" style={{ width: 130 }}>Jumlah</th>
                <th className="num" style={{ width: 130 }}>Rata-rata</th>
                <th className="num" style={{ width: 150 }}>Nilai</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId} style={{ cursor: "default" }}>
                  <td>
                    <span className="idc">
                      <span className="lab">{r.itemLabel}</span>
                      <span className="nm">{r.itemName}</span>
                    </span>
                  </td>
                  <td>
                    <span className="lab">{r.uomLabel}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{qty(r.qty)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{formatPrice(r.average)}</span>
                  </td>
                  <td className="num">
                    <span className="mny">{money(r.value)}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="mut" style={{ textAlign: "center" }}>
                    Tidak ada persediaan pada tanggal ini.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="totrow">
                <td colSpan={4}>Total</td>
                <td className="num">
                  <b>{money(total)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {!gl.ok && (
        <div className="nbox warn slim">
          <span className="ni">
            <Icon name="warn" size={14} />
          </span>
          <div>
            <b>Tidak dicocokkan dengan Buku Besar.</b>
            <p>{gl.missing}</p>
          </div>
        </div>
      )}
      <Mismatch show={!reconciles} />
    </>
  );
}
