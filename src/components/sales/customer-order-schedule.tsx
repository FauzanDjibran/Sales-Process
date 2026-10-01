import Link from "next/link";
import { Icon } from "@/components/icon";
import type { CustomerOrderSchedule } from "@/lib/erp/sales-order";
import { SALES_ORDER_STATUS_BADGE, SALES_ORDER_STATUS_TEXT } from "@/lib/erp/sales-order-workflow";
import { formatDate, formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * How much of a Customer Order has been released to PPIC (P79): per line, what
 * the Sales Orders hold and what is left, then the Sales Orders themselves by
 * delivery date, each a link. The quantities are the Customer Order's own
 * state — how far it is scheduled — not another document's figures.
 */
export function CustomerOrderScheduleCard({
  customerOrderId,
  schedule,
  canCreate,
  open,
}: {
  customerOrderId: number;
  schedule: CustomerOrderSchedule;
  /** May this user make a Sales Order, and is the Customer Order Open? */
  canCreate: boolean;
  open: boolean;
}) {
  const anyLeft = schedule.lines.some((l) => l.qty - l.held > 0);
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <span className="ci">
          <Icon name="cal" size={15} />
        </span>
        <div className="ct">
          <h3>Jadwal Sales Order</h3>
          <p>Bagian Customer Order yang sudah dilepas ke PPIC. Sales Order yang dibatalkan atau ditolak tidak dihitung.</p>
        </div>
        {canCreate && open && anyLeft && (
          <Link className="btn sm primary" href={`/sales/order/new?co=${customerOrderId}`}>
            <Icon name="plus" size={14} /> Sales Order Baru
          </Link>
        )}
      </div>
      <div className="tw">
        <table className="grid ltab">
          <thead>
            <tr>
              <th style={{ minWidth: 240 }}>Barang</th>
              <th style={{ width: 90 }}>Satuan</th>
              <th className="num" style={{ width: 130 }}>
                Dipesan
              </th>
              <th className="num" style={{ width: 130 }}>
                Dijadwalkan
              </th>
              <th className="num" style={{ width: 130 }}>
                Sisa
              </th>
            </tr>
          </thead>
          <tbody>
            {schedule.lines.map((l) => (
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
                    <span className="bdg s-ok">Terjadwal</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {schedule.orders.length ? (
        <div className="tw">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 170 }}>Sales Order</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 120 }}>Tanggal SO</th>
                <th>Tanggal Kirim</th>
              </tr>
            </thead>
            <tbody>
              {schedule.orders.map((o) => (
                <tr key={o.id} style={{ cursor: "default" }}>
                  <td>
                    <Link className="lab" href={`/sales/order/${o.id}`}>
                      {o.orderNo}
                    </Link>
                  </td>
                  <td>
                    <span className={`bdg ${SALES_ORDER_STATUS_BADGE[o.status]}`}>{SALES_ORDER_STATUS_TEXT[o.status]}</span>
                  </td>
                  <td>{formatDate(o.orderDate)}</td>
                  <td>{formatDate(o.deliveryDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fnote">
          {open ? "Belum ada Sales Order dari Customer Order ini." : "Sales Order dibuat dari Customer Order berstatus Open."}
        </p>
      )}
    </div>
  );
}
