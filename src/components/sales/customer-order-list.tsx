"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { CustomerOrderListRow } from "@/lib/erp/customer-order";
import {
  CUSTOMER_ORDER_STATUS_BADGE,
  CUSTOMER_ORDER_STATUS_TEXT,
  CUSTOMER_ORDER_TRANSITIONS,
  availableCustomerOrderActions,
  customerOrderIsEditable,
  type CustomerOrderAbilities,
  type CustomerOrderStatus,
} from "@/lib/erp/customer-order-workflow";

const STATUSES: CustomerOrderStatus[] = ["Draft", "Submitted", "Open", "Closed", "Cancelled", "Rejected"];

/** The Customer Order register. */
export function CustomerOrderList({ orders, can }: { orders: CustomerOrderListRow[]; can: CustomerOrderAbilities }) {
  return (
    <DocumentRegister
      module="Penjualan"
      icon="clip"
      title="Customer Order"
      sub="Pesanan barang dari customer, dengan jumlah, harga dan pajaknya."
      base="/sales/customer-order"
      newLabel="Buat Customer Order"
      canCreate={can.create}
      searchHint="Cari nomor CO, PO atau customer…"
      statuses={STATUSES}
      statusText={CUSTOMER_ORDER_STATUS_TEXT}
      statusBadge={CUSTOMER_ORDER_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="No. PO Customer"
      columns={[{ key: "lines", label: "Baris", width: 54, num: true }]}
      valueLabel="Nilai"
      empty="Catat pesanan pertama — mulai dari memilih customer."
      rows={orders.map((o) => ({
        id: o.id,
        no: o.orderNo,
        status: o.status,
        date: o.orderDate,
        partner: { label: o.customerLabel, name: o.customerName },
        source: o.poNo ? { no: o.poNo } : null,
        cells: { lines: o.lines },
        value: <Amount value={o.total} currency={o.currency} />,
        editable: can.edit && customerOrderIsEditable(o.status),
        steps: rowSteps(availableCustomerOrderActions(o.status, can), CUSTOMER_ORDER_TRANSITIONS),
      }))}
    />
  );
}
