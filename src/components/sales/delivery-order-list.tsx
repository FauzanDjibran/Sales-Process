"use client";

import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { DeliveryOrderListRow } from "@/lib/erp/delivery-order";
import {
  DELIVERY_ORDER_STATUS_BADGE,
  DELIVERY_ORDER_STATUS_TEXT,
  DELIVERY_ORDER_TRANSITIONS,
  availableDeliveryOrderActions,
  deliveryOrderIsEditable,
  type DeliveryOrderAbilities,
  type DeliveryOrderStatus,
} from "@/lib/erp/delivery-order-workflow";
import { formatDate } from "@/lib/format";

const STATUSES: DeliveryOrderStatus[] = ["Draft", "Issued", "Closed", "Cancelled"];

/** The Delivery Order register (P93). */
export function DeliveryOrderList({ orders, can }: { orders: DeliveryOrderListRow[]; can: DeliveryOrderAbilities }) {
  return (
    <DocumentRegister
      module="Penjualan"
      icon="truck"
      title="Delivery Order"
      sub="Perintah kirim ke gudang, untuk barang Sales Order yang Open."
      base="/sales/delivery-order"
      newLabel="Buat Delivery Order"
      canCreate={can.create}
      searchHint="Cari nomor DO, CO, customer atau gudang…"
      statuses={STATUSES}
      statusText={DELIVERY_ORDER_STATUS_TEXT}
      statusBadge={DELIVERY_ORDER_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="Customer Order"
      columns={[
        { key: "delivery", label: "Tgl Kirim", width: 90 },
        { key: "warehouse", label: "Gudang", width: 90 },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      empty="Delivery Order dibuat dari Customer Order yang Sales Order-nya Open."
      rows={orders.map((o) => ({
        id: o.id,
        no: o.doNo,
        status: o.status,
        date: o.doDate,
        partner: { label: o.customerLabel, name: o.customerName },
        source: { no: o.customerOrderNo, href: `/sales/customer-order/${o.customerOrderId}` },
        cells: { delivery: formatDate(o.deliveryDate), warehouse: <span className="lab">{o.warehouseLabel}</span>, lines: o.lines },
        search: o.warehouseLabel,
        editable: can.edit && deliveryOrderIsEditable(o.status),
        steps: rowSteps(availableDeliveryOrderActions(o.status, can), DELIVERY_ORDER_TRANSITIONS),
      }))}
    />
  );
}
