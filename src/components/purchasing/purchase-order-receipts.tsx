import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";
import { RECEIPT_NOTE_STATUS_BADGE, RECEIPT_NOTE_STATUS_TEXT, type ReceiptNoteStatus } from "@/lib/erp/receipt-note-workflow";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_TEXT, type InvoiceStatus } from "@/lib/erp/ap-invoice-workflow";

/**
 * A Purchase Order's receipts, linked, never embedded (§8): the page composes
 * them from the Receipt Note module. What each line received shows on the line.
 */
export function PurchaseOrderReceipts({
  receipts,
  invoices = [],
}: {
  receipts: { id: number; rnNo: string; rnDate: string; status: ReceiptNoteStatus }[];
  invoices?: { id: number; invoiceNo: string; invoiceDate: string; status: InvoiceStatus }[];
}) {
  if (!receipts.length && !invoices.length) return null;
  const rows = [
    ...receipts.map((r) => ({ key: `r${r.id}`, href: `/inventory/receipt-note/${r.id}`, no: r.rnNo, date: r.rnDate, badge: RECEIPT_NOTE_STATUS_BADGE[r.status], text: RECEIPT_NOTE_STATUS_TEXT[r.status] })),
    ...invoices.map((r) => ({ key: `i${r.id}`, href: `/finance/invoice/purchase/${r.id}`, no: r.invoiceNo, date: r.invoiceDate, badge: INVOICE_STATUS_BADGE[r.status], text: INVOICE_STATUS_TEXT[r.status] })),
  ];
  return (
    <div className="fgrid solo">
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="ci">
            <Icon name="box" size={15} />
          </span>
          <div className="ct">
            <h3>Penerimaan &amp; Tagihan</h3>
            <p>Receipt Note dan Invoice Pembelian dari Purchase Order ini.</p>
          </div>
        </div>
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 180 }}>Dokumen</th>
                <th style={{ width: 120 }}>Tanggal</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <Link className="lab" href={r.href}>
                      {r.no}
                    </Link>
                  </td>
                  <td>{formatDate(r.date)}</td>
                  <td>
                    <span className={`bdg ${r.badge}`}>{r.text}</span>
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
