import Link from "next/link";
import { Icon } from "@/components/icon";
import type { SalesOrderDeliveries } from "@/lib/erp/delivery-order";
import { DELIVERY_ORDER_STATUS_BADGE, DELIVERY_ORDER_STATUS_TEXT } from "@/lib/erp/delivery-order-workflow";
import { formatDate, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * How much of a Sales Order has been instructed to the warehouse (P93): per
 * line, what the Delivery Orders hold and what is left, then the Delivery
 * Orders themselves by ship date, each a link. The quantities are the Sales
 * Order's own state — how far it is instructed — not another document's figures.
 */
export function SalesOrderDeliveriesCard({
  salesOrderId,
  deliveries,
  canCreate,
  open,
}: {
  salesOrderId: number;
  deliveries: SalesOrderDeliveries;
  /** May this user make a Delivery Order, and is the Sales Order Open? */
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
          <h3>Perintah Kirim</h3>
          <p>
            Bagian Sales Order yang sudah diperintahkan ke gudang, dan yang sudah keluar dengan Delivery Note. Delivery Order
            yang dibatalkan tidak dihitung; yang ditutup hanya menghitung yang sudah terkirim.
          </p>
        </div>
        {canCreate && open && anyLeft && (
          <Link className="btn sm primary" href={`/sales/delivery-order/new?so=${salesOrderId}`}>
            <Icon name="plus" size={14} /> Delivery Order Baru
          </Link>
        )}
      </div>
      <div className="tw">
        <table className="grid ltab" style={{ minWidth: 830 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 240 }}>Barang</th>
              <th style={{ width: 90 }}>Satuan</th>
              <th className="num" style={{ width: 130 }}>
                Qty SO
              </th>
              <th className="num" style={{ width: 130 }}>
                Di-DO
              </th>
              <th className="num" style={{ width: 130 }}>
                Terkirim
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
                  {l.delivered ? <span className="mny">{qtyText(l.delivered)}</span> : <span className="dash">—</span>}
                </td>
                <td className="num">
                  {l.qty - l.held > 0 ? (
                    <span className="mny">{qtyText(l.qty - l.held)}</span>
                  ) : (
                    <span className="bdg s-ok">Diperintahkan</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deliveries.orders.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 170 }}>Delivery Order</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 120 }}>Tanggal DO</th>
                <th>Tanggal Kirim</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.orders.map((o) => (
                <tr key={o.id} style={{ cursor: "default" }}>
                  <td>
                    <Link className="lab" href={`/sales/delivery-order/${o.id}`}>
                      {o.doNo}
                    </Link>
                  </td>
                  <td>
                    <span className={`bdg ${DELIVERY_ORDER_STATUS_BADGE[o.status]}`}>{DELIVERY_ORDER_STATUS_TEXT[o.status]}</span>
                  </td>
                  <td>{formatDate(o.doDate)}</td>
                  <td>{formatDate(o.deliveryDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fnote">
          {open ? "Belum ada Delivery Order dari Sales Order ini." : "Delivery Order dibuat dari Sales Order berstatus Open."}
        </p>
      )}
    </div>
  );
}
