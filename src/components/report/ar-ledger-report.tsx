import { Icon } from "@/components/icon";
import { ReportSummary } from "@/components/report/report-summary";
import { DocLink } from "@/components/report/customer-advance-report";
import { AR_EVENT_TEXT, AR_TYPE_TEXT, type ArLedgerReport } from "@/lib/erp/ar-item";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Buku Piutang (P72, P75, P77) — one customer's AR items over a period, entry
 * by entry, each signed on their Piutang Usaha position: an Invoice raises it,
 * a payment moves it back. Oldest first, with the position carried in at the
 * top and struck at the bottom. By default only Invoice items are in the book
 * and the Uang Muka still held is stated under it; with Uang Muka included,
 * a down payment lowers the position and its use at an Invoice raises it back.
 */
const money = (n: number) => formatMoney(n, "IDR");

export function ArLedgerReportBody({
  report,
  orderNos,
}: {
  report: ArLedgerReport;
  /** Customer Order numbers by id, composed by the page (the order is another module's). */
  orderNos: Record<number, string>;
}) {
  // The position after each entry, worked out before rendering.
  const positions = report.entries.reduce<number[]>(
    (acc, e) => [...acc, (acc.length ? acc[acc.length - 1] : report.opening) + e.exposure],
    []
  );
  return (
    <>
      <div className="cblock">
        <div className="cbh">
          <b>{report.partner.label}</b>
          <span className="cbn">
            {report.partner.name} · {report.entries.length} entri
          </span>
          <ReportSummary
            figures={[
              { label: "Posisi Awal", value: money(report.opening), zero: !report.opening },
              { label: "Menambah", value: money(report.increase), zero: !report.increase },
              { label: "Mengurangi", value: money(report.decrease), zero: !report.decrease },
              { label: "Posisi Akhir", value: money(report.closing), key: true, negative: report.closing < 0 },
            ]}
          />
        </div>
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 92 }}>Tanggal</th>
                <th style={{ width: 150 }}>Dokumen</th>
                <th style={{ width: 210 }}>AR Item</th>
                <th>Keterangan</th>
                <th className="num" style={{ width: 124 }}>Menambah</th>
                <th className="num" style={{ width: 124 }}>Mengurangi</th>
                <th className="num" style={{ width: 132 }}>Posisi</th>
              </tr>
            </thead>
            <tbody>
              <tr className="totrow">
                <td colSpan={4}>Posisi Piutang Usaha per {formatDate(report.range.from)}</td>
                <td className="num mut">—</td>
                <td className="num mut">—</td>
                <td className="num">{money(report.opening)}</td>
              </tr>
              {report.entries.map((e, i) => {
                return (
                  <tr key={e.id} style={{ cursor: "default" }}>
                    <td className="mono mut" style={{ fontSize: "11.5px" }}>
                      <span className="dstack">
                        <span>{formatDate(e.date)}</span>
                        <span className="d2">{e.ledgerNo}</span>
                      </span>
                    </td>
                    <td>
                      <DocLink table={e.docTable} id={e.docId} no={e.docNo} />
                    </td>
                    <td>
                      <span className="dstack">
                        <span>
                          <span className={`bdg ${e.type === "Advance" ? "t-vio" : "t-info"}`}>{AR_TYPE_TEXT[e.type]}</span>{" "}
                          <span className="lab">{e.itemNo}</span>
                        </span>
                        <span className="d2">
                          {e.itemSourceNo}
                          {e.orderId && orderNos[e.orderId] ? ` · ${orderNos[e.orderId]}` : ""}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="dstack">
                        <span>{AR_EVENT_TEXT[e.event]}</span>
                        {e.note && <span className="d2" style={{ fontFamily: "inherit", whiteSpace: "normal" }}>{e.note}</span>}
                      </span>
                    </td>
                    <td className="num">{e.exposure > 0 ? <span className="mny">{money(e.exposure)}</span> : <span className="dash">–</span>}</td>
                    <td className="num">{e.exposure < 0 ? <span className="mny">{money(-e.exposure)}</span> : <span className="dash">–</span>}</td>
                    <td className="num"><span className="mny">{money(positions[i])}</span></td>
                  </tr>
                );
              })}
              {report.entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="mut" style={{ textAlign: "center" }}>
                    Tidak ada perubahan pada rentang tanggal ini. Posisi akhir sama dengan posisi awal.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="totrow">
                <td colSpan={4}>Posisi Piutang Usaha per {formatDate(report.range.to)}</td>
                <td className="num"><span className="mny">{money(report.increase)}</span></td>
                <td className="num"><span className="mny">{money(report.decrease)}</span></td>
                <td className="num"><b>{money(report.closing)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="nbox slim">
        <span className="ni"><Icon name="scale" size={14} /></span>
        <div>
          <b>
            Per {formatDate(report.range.to)}: Invoice terbuka {money(report.closingByType.Invoice)} − Uang Muka terbuka{" "}
            {money(report.closingByType.Advance)} = Posisi bersih {money(report.closingByType.Invoice - report.closingByType.Advance)}
          </b>
          {!report.includeAdvance && report.closingByType.Advance > 0 && (
            <p>Uang muka tidak dimasukkan ke buku di atas — dipakai saat Invoice Penjualan atas Customer Order yang sama diposting.</p>
          )}
        </div>
      </div>
    </>
  );
}
