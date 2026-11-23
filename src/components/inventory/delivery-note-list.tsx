"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { DeliveryNoteListRow } from "@/lib/erp/delivery-note";
import {
  DELIVERY_NOTE_STATUS_BADGE,
  DELIVERY_NOTE_STATUS_TEXT,
  DELIVERY_NOTE_TRANSITIONS,
  availableDeliveryNoteActions,
  deliveryNoteIsEditable,
  type DeliveryNoteAbilities,
  type DeliveryNoteStatus,
} from "@/lib/erp/delivery-note-workflow";

const STATUSES: DeliveryNoteStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Delivery Note register (C28). The HPP is what a posted note recognised. */
export function DeliveryNoteList({ orders, can }: { orders: DeliveryNoteListRow[]; can: DeliveryNoteAbilities }) {
  return (
    <DocumentRegister
      module="Persediaan"
      icon="truck"
      title="Delivery Note"
      sub="Barang yang keluar dari gudang menurut Delivery Order."
      base="/inventory/delivery-note"
      newLabel="Buat Delivery Note"
      canCreate={can.create}
      searchHint="Cari nomor SJ, DO, CO, customer atau gudang…"
      statuses={STATUSES}
      statusText={DELIVERY_NOTE_STATUS_TEXT}
      statusBadge={DELIVERY_NOTE_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="Delivery Order"
      columns={[
        { key: "warehouse", label: "Gudang", width: 90 },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      valueLabel="HPP"
      empty="Delivery Note dibuat dari Delivery Order yang sudah diterbitkan."
      rows={orders.map((o) => ({
        id: o.id,
        no: o.dnNo,
        status: o.status,
        date: o.dnDate,
        partner: { label: o.customerLabel, name: o.customerName },
        source: { no: o.sourceNo, href: `/sales/delivery-order/${o.sourceId}`, note: o.customerOrderNo },
        cells: { warehouse: <span className="lab">{o.warehouseLabel}</span>, lines: o.lines },
        value: o.status === "Posted" ? <Amount value={o.cost} /> : null,
        search: [o.customerOrderNo, o.warehouseLabel].join(" "),
        editable: can.edit && deliveryNoteIsEditable(o.status),
        steps: rowSteps(availableDeliveryNoteActions(o.status, can), DELIVERY_NOTE_TRANSITIONS),
      }))}
    />
  );
}
