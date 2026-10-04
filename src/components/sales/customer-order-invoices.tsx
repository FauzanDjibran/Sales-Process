import Link from "next/link";
import { Icon } from "@/components/icon";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_TEXT, type InvoiceStatus } from "@/lib/erp/sales-invoice-workflow";
import { formatDate } from "@/lib/format";

/**
 * The Invoices drawn from a Customer Order (§9), each a link — their figures are
 * their own, so the order shows only which exist and where they stand. A
 * closed order is still billed for what it sent (U21).
 */
export function CustomerOrderInvoicesCard({
  customerOrderId,
  invoices,
  canCreate,
}: {
  customerOrderId: number;
  invoices: { id: number; invoiceNo: string; invoiceDate: string; status: InvoiceStatus }[];
  canCreate: boolean;
}) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="file" size={15} />
        </span>
        <div className="ct">
          <h3>Invoice Penjualan</h3>
          <p>Tagihan atas barang Customer Order ini yang sudah dikirim.</p>
        </div>
        {canCreate && (
          <Link className="btn sm primary" href={`/sales/invoice/new?co=${customerOrderId}`}>
            <Icon name="plus" size={14} /> Invoice Baru
          </Link>
        )}
      </div>
      {invoices.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 170 }}>Nomor</th>
                <th style={{ width: 120 }}>Tanggal</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} style={{ cursor: "default" }}>
                  <td>
                    <Link className="lab" href={`/sales/invoice/${i.id}`}>
                      {i.invoiceNo}
                    </Link>
                  </td>
                  <td>{formatDate(i.invoiceDate)}</td>
                  <td>
                    <span className={`bdg ${INVOICE_STATUS_BADGE[i.status]}`}>{INVOICE_STATUS_TEXT[i.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty sm">
          <div className="ic">
            <Icon name="file" size={18} />
          </div>
          <h4>Belum ada invoice</h4>
          <p>Invoice dibuat dari barang yang sudah dikirim dengan Delivery Note yang diposting.</p>
        </div>
      )}
    </div>
  );
}
