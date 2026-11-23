"use client";

import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { SalesReturnListRow } from "@/lib/erp/sales-return";
import {
  SALES_RETURN_STATUS_BADGE,
  SALES_RETURN_STATUS_TEXT,
  SALES_RETURN_TRANSITIONS,
  availableSalesReturnActions,
  salesReturnIsEditable,
  salesReturnReasonLabel,
  type SalesReturnAbilities,
  type SalesReturnStatus,
} from "@/lib/erp/sales-return-workflow";

const STATUSES: SalesReturnStatus[] = ["Draft", "Submitted", "Open", "Closed", "Rejected", "Cancelled"];

/** The Sales Return register (P288). */
export function SalesReturnList({ rows, can }: { rows: SalesReturnListRow[]; can: SalesReturnAbilities }) {
  return (
    <DocumentRegister
      module="Penjualan"
      icon="box"
      title="Sales Return"
      sub="Barang yang dikembalikan customer dari pengiriman yang sudah diposting."
      base="/sales/return"
      newLabel="Buat Sales Return"
      canCreate={can.create}
      searchHint="Cari nomor retur, CO atau customer…"
      statuses={STATUSES}
      statusText={SALES_RETURN_STATUS_TEXT}
      statusBadge={SALES_RETURN_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="Customer Order"
      columns={[
        { key: "reason", label: "Alasan", width: 150 },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      empty="Sales Return dibuat dari Customer Order yang barangnya sudah dikirim."
      rows={rows.map((o) => ({
        id: o.id,
        no: o.returnNo,
        status: o.status,
        date: o.returnDate,
        partner: { label: o.customerLabel, name: o.customerName },
        source: { no: o.customerOrderNo, href: `/sales/customer-order/${o.customerOrderId}` },
        cells: { reason: salesReturnReasonLabel(o.reason), lines: o.lines },
        editable: can.edit && salesReturnIsEditable(o.status),
        steps: rowSteps(availableSalesReturnActions(o.status, can), SALES_RETURN_TRANSITIONS),
      }))}
    />
  );
}
