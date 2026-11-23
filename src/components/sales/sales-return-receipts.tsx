import Link from "next/link";
import { Icon } from "@/components/icon";
import { RECEIPT_NOTE_STATUS_BADGE, RECEIPT_NOTE_STATUS_TEXT, type ReceiptNoteStatus } from "@/lib/erp/receipt-note-workflow";
import { formatDate } from "@/lib/format";

/**
 * The Receipt Notes that brought a Sales Return's goods back (P288), each a
 * link — composed by the page from the Receipt Note module. What each line
 * received is the return's own figure, shown on its lines.
 */
export function SalesReturnReceiptsCard({
  receipts,
}: {
  receipts: { id: number; rnNo: string; rnDate: string; status: ReceiptNoteStatus }[];
}) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="box" size={15} />
        </span>
        <div className="ct">
          <h3>Penerimaan Gudang</h3>
          <p>Barang yang sudah diterima kembali dengan Receipt Note, atau disiapkan oleh Receipt Note Draft.</p>
        </div>
      </div>
      {receipts.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 170 }}>Receipt Note</th>
                <th style={{ width: 120 }}>Status</th>
                <th>Tanggal Terima</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} style={{ cursor: "default" }}>
                  <td>
                    <Link className="lab" href={`/inventory/receipt-note/${r.id}`}>
                      {r.rnNo}
                    </Link>
                  </td>
                  <td>
                    <span className={`bdg ${RECEIPT_NOTE_STATUS_BADGE[r.status]}`}>{RECEIPT_NOTE_STATUS_TEXT[r.status]}</span>
                  </td>
                  <td>{formatDate(r.rnDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fnote">Belum ada Receipt Note untuk Sales Return ini.</p>
      )}
    </div>
  );
}
