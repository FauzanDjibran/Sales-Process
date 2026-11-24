import Link from "next/link";
import { Icon } from "@/components/icon";
import { formatDate } from "@/lib/format";
import { PURCHASE_ORDER_STATUS_BADGE, PURCHASE_ORDER_STATUS_TEXT, type PurchaseOrderStatus } from "@/lib/erp/purchase-order-workflow";

/** The Purchase Orders that order from a request, linked, never embedded (§8). */
export function PurchaseRequestOrders({
  basePath,
  orders,
}: {
  basePath: string;
  orders: { id: number; orderNo: string; orderDate: string; status: PurchaseOrderStatus; supplierLabel: string; supplierName: string }[];
}) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="ci">
          <Icon name="clip" size={15} />
        </span>
        <div className="ct">
          <h3>Purchase Order</h3>
          <p>Pesanan yang memakai Purchase Request ini.</p>
        </div>
      </div>
      <div className="tw">
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 180 }}>Dokumen</th>
              <th style={{ width: 120 }}>Tanggal</th>
              <th>Supplier</th>
              <th style={{ width: 130 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link className="lab" href={`${basePath}/${o.id}`}>
                    {o.orderNo}
                  </Link>
                </td>
                <td>{formatDate(o.orderDate)}</td>
                <td>
                  <span className="idc">
                    <span className="lab">{o.supplierLabel}</span>
                    <span className="nm">{o.supplierName}</span>
                  </span>
                </td>
                <td>
                  <span className={`bdg ${PURCHASE_ORDER_STATUS_BADGE[o.status]}`}>{PURCHASE_ORDER_STATUS_TEXT[o.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
