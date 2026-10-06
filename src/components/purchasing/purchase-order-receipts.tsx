import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";
import { RECEIPT_NOTE_STATUS_BADGE, RECEIPT_NOTE_STATUS_TEXT, type ReceiptNoteStatus } from "@/lib/erp/receipt-note-workflow";

/**
 * A Purchase Order's receipts, linked, never embedded (§8): the page composes
 * them from the Receipt Note module. What each line received shows on the line.
 */
export function PurchaseOrderReceipts({ receipts }: { receipts: { id: number; rnNo: string; rnDate: string; status: ReceiptNoteStatus }[] }) {
  if (!receipts.length) return null;
  return (
    <div className="fgrid solo">
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="box" size={15} />
          </span>
          <div className="ct">
            <h3>Penerimaan</h3>
            <p>Receipt Note dari Purchase Order ini.</p>
          </div>
        </div>
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 180 }}>Receipt Note</th>
                <th style={{ width: 120 }}>Tanggal</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="lab" href={`/logistics/receipt-note/${r.id}`}>
                      {r.rnNo}
                    </Link>
                  </td>
                  <td>{formatDate(r.rnDate)}</td>
                  <td>
                    <span className={`bdg ${RECEIPT_NOTE_STATUS_BADGE[r.status]}`}>{RECEIPT_NOTE_STATUS_TEXT[r.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
