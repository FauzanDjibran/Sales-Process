import Link from "next/link";
import { Icon } from "@/components/icon";
import type { DeliveryOrderNotes } from "@/lib/erp/delivery-note";
import { DELIVERY_NOTE_STATUS_BADGE, DELIVERY_NOTE_STATUS_TEXT } from "@/lib/erp/delivery-note-workflow";
import { formatDate, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * How much of a Delivery Order has left the warehouse (C28): per line, what the
 * Delivery Notes sent or reserved and what is left, then the notes themselves
 * by date, each a link. The quantities are the Delivery Order's own state — how
 * far it is shipped — not another document's figures.
 */
export function DeliveryOrderNotesCard({
  deliveryOrderId,
  deliveries,
  canCreate,
  open,
}: {
  deliveryOrderId: number;
  deliveries: DeliveryOrderNotes;
  /** May this user make a Delivery Note, and is the Delivery Order issued? */
  canCreate: boolean;
  open: boolean;
}) {
  const anyLeft = deliveries.lines.some((l) => l.qty - l.held > 0);
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="truck" size={15} />
        </span>
        <div className="ct">
          <h3>Pengiriman</h3>
          <p>Barang yang sudah keluar dengan Delivery Note, atau disiapkan oleh Delivery Note Draft. Yang dibatalkan tidak dihitung.</p>
        </div>
        {canCreate && open && anyLeft && (
          <Link className="btn sm primary" href={`/inventory/delivery-note/new?do=${deliveryOrderId}`}>
            <Icon name="plus" size={14} /> Delivery Note Baru
          </Link>
        )}
      </div>
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 240 }}>Barang</th>
              <th style={{ width: 90 }}>Satuan</th>
              <th className="num" style={{ width: 130 }}>
                Qty DO
              </th>
              <th className="num" style={{ width: 130 }}>
                Dikirim
              </th>
              <th className="num" style={{ width: 130 }}>
                Sisa
              </th>
            </tr>
          </thead>
          <tbody>
            {deliveries.lines.map((l) => (
              <tr key={l.id} style={{ cursor: "default" }}>
                <td>
                  <span className="idc">
                    <span className="lab">{l.itemLabel}</span>
                    <span className="nm">{l.itemName}</span>
                  </span>
                </td>
                <td>
                  <span className="lab">{l.uomLabel}</span>
                </td>
                <td className="num">
                  <span className="mny">{qtyText(l.qty)}</span>
                </td>
                <td className="num">
                  {l.held ? <span className="mny">{qtyText(l.held)}</span> : <span className="dash">—</span>}
                </td>
                <td className="num">
                  {l.qty - l.held > 0 ? (
                    <span className="mny">{qtyText(l.qty - l.held)}</span>
                  ) : (
                    <span className="bdg s-ok">Terkirim</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deliveries.notes.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 170 }}>Delivery Note</th>
                <th style={{ width: 120 }}>Status</th>
                <th>Tanggal Kirim</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.notes.map((o) => (
                <tr key={o.id} style={{ cursor: "default" }}>
                  <td>
                    <Link className="lab" href={`/inventory/delivery-note/${o.id}`}>
                      {o.dnNo}
                    </Link>
                  </td>
                  <td>
                    <span className={`bdg ${DELIVERY_NOTE_STATUS_BADGE[o.status]}`}>{DELIVERY_NOTE_STATUS_TEXT[o.status]}</span>
                  </td>
                  <td>{formatDate(o.dnDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fnote">
          {open ? "Belum ada Delivery Note dari Delivery Order ini." : "Delivery Note dibuat dari Delivery Order yang sudah diterbitkan."}
        </p>
      )}
    </div>
  );
}
