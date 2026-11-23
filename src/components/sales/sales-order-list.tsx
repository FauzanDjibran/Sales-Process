"use client";

import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { SalesOrderListRow } from "@/lib/erp/sales-order";
import {
  SALES_ORDER_STATUS_BADGE,
  SALES_ORDER_STATUS_TEXT,
  SALES_ORDER_TRANSITIONS,
  availableSalesOrderActions,
  salesOrderIsEditable,
  type SalesOrderAbilities,
  type SalesOrderStatus,
} from "@/lib/erp/sales-order-workflow";
import { formatDate } from "@/lib/format";

const STATUSES: SalesOrderStatus[] = ["Draft", "Submitted", "PreSO", "Open", "Closed", "Cancelled", "Rejected"];

/** The Sales Order register (P79). */
export function SalesOrderList({ orders, can }: { orders: SalesOrderListRow[]; can: SalesOrderAbilities }) {
  return (
    <DocumentRegister
      module="Penjualan"
      icon="cal"
      title="Sales Order"
      sub="Bagian Customer Order yang dilepas ke PPIC dengan tanggal kirimnya."
      base="/sales/order"
      newLabel="Buat Sales Order"
      canCreate={can.create}
      searchHint="Cari nomor SO, CO atau customer…"
      statuses={STATUSES}
      statusText={SALES_ORDER_STATUS_TEXT}
      statusBadge={SALES_ORDER_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="Customer Order"
      columns={[
        { key: "delivery", label: "Tgl Kirim", width: 90 },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      empty="Sales Order dibuat dari Customer Order berstatus Open."
      rows={orders.map((o) => ({
        id: o.id,
        no: o.orderNo,
        status: o.status,
        date: o.orderDate,
        partner: { label: o.customerLabel, name: o.customerName },
        source: { no: o.customerOrderNo, href: `/sales/customer-order/${o.customerOrderId}` },
        cells: { delivery: formatDate(o.deliveryDate), lines: o.lines },
        editable: can.edit && salesOrderIsEditable(o.status),
        steps: rowSteps(availableSalesOrderActions(o.status, can), SALES_ORDER_TRANSITIONS),
      }))}
    />
  );
}
