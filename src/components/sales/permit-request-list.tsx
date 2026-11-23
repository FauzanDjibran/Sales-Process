"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { PermitRequestListRow } from "@/lib/erp/permit-request";
import {
  PERMIT_REQUEST_STATUS_BADGE,
  PERMIT_REQUEST_STATUS_TEXT,
  PERMIT_REQUEST_TRANSITIONS,
  availablePermitRequestActions,
  permitRequestIsEditable,
  type PermitRequestAbilities,
  type PermitRequestStatus,
} from "@/lib/erp/permit-request-workflow";

const STATUSES: PermitRequestStatus[] = ["Draft", "Submitted", "Open", "Realized", "Done", "Cancelled", "Rejected"];

/** The Pengajuan Perizinan register (P139). */
export function PermitRequestList({ requests, can }: { requests: PermitRequestListRow[]; can: PermitRequestAbilities }) {
  return (
    <DocumentRegister
      module="Penjualan"
      icon="clip"
      title="Pengajuan Perizinan"
      sub="Perizinan yang diurus untuk produk customer: estimasi, lalu realisasinya."
      base="/sales/permit"
      newLabel="Buat Pengajuan Perizinan"
      canCreate={can.create}
      searchHint="Cari nomor, customer atau produk…"
      statuses={STATUSES}
      statusText={PERMIT_REQUEST_STATUS_TEXT}
      statusBadge={PERMIT_REQUEST_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="No. PO Customer"
      columns={[
        { key: "product", label: "Produk", width: 150 },
        { key: "realization", label: "Realisasi", width: 140 },
      ]}
      valueLabel="Nilai"
      empty="Buat pengajuan pertama — mulai dari memilih customer."
      rows={requests.map((o) => ({
        id: o.id,
        no: o.requestNo,
        status: o.status,
        date: o.requestDate,
        partner: { label: o.customerLabel, name: o.customerName },
        source: o.poNo ? { no: o.poNo } : null,
        cells: { product: o.productName, realization: o.realizationNo && <span className="mono">{o.realizationNo}</span> },
        value: <Amount value={o.total} />,
        search: o.productName,
        editable: can.edit && permitRequestIsEditable(o.status),
        // Realisasi needs its prices first, so it is taken from the document.
        steps: rowSteps(
          availablePermitRequestActions(o.status, can).filter((a) => a !== "realize"),
          PERMIT_REQUEST_TRANSITIONS
        ),
      }))}
    />
  );
}
