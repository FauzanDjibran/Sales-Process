import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";
import { RECEIPT_NOTE_STATUS_BADGE, RECEIPT_NOTE_STATUS_TEXT, type ReceiptNoteStatus } from "@/lib/erp/receipt-note-workflow";
import { ADVANCE_STATUS_BADGE, ADVANCE_STATUS_TEXT, type AdvanceStatus } from "@/lib/erp/ar-advance-workflow";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_TEXT, type InvoiceStatus } from "@/lib/erp/ap-invoice-workflow";

/**
 * A Purchase Order's advance bills, receipts and invoices, linked, never embedded (§8): the page composes
 * them from their modules. What each line received shows on the line.
 */
export function PurchaseOrderReceipts({
  receipts,
  invoices = [],
  advances = [],
}: {
  receipts: { id: number; rnNo: string; rnDate: string; status: ReceiptNoteStatus }[];
  advances?: { id: number; advanceNo: string; advanceDate: string; status: AdvanceStatus }[];
  invoices?: { id: number; invoiceNo: string; invoiceDate: string; status: InvoiceStatus }[];
}) {
  if (!receipts.length && !invoices.length && !advances.length) return null;
  const rows = [
    ...advances.map((r) => ({ key: `a${r.id}`, href: `/finance/advance/purchase/${r.id}`, no: r.advanceNo, date: r.advanceDate, badge: ADVANCE_STATUS_BADGE[r.status], text: ADVANCE_STATUS_TEXT[r.status] })),
    ...receipts.map((r) => ({ key: `r${r.id}`, href: `/inventory/receipt-note/${r.id}`, no: r.rnNo, date: r.rnDate, badge: RECEIPT_NOTE_STATUS_BADGE[r.status], text: RECEIPT_NOTE_STATUS_TEXT[r.status] })),
    ...invoices.map((r) => ({ key: `i${r.id}`, href: `/finance/invoice/purchase/${r.id}`, no: r.invoiceNo, date: r.invoiceDate, badge: INVOICE_STATUS_BADGE[r.status], text: INVOICE_STATUS_TEXT[r.status] })),
  ];
  return (
    <div className="fgrid solo">
      <div className="card">
        <div className="card-h">
          <span className="ci">
            <Icon name="box" size={15} />
          </span>
          <div className="ct">
            <h3>Penerimaan &amp; Tagihan</h3>
            <p>Uang Muka, Receipt Note dan Invoice Pembelian dari Purchase Order ini.</p>
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
