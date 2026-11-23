"use client";

import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { PurchaseRequestListRow } from "@/lib/erp/purchase-request";
import {
  PURCHASE_REQUEST_KINDS,
  PURCHASE_REQUEST_STATUS_BADGE,
  PURCHASE_REQUEST_STATUS_TEXT,
  PURCHASE_REQUEST_TRANSITIONS,
  availablePurchaseRequestActions,
  purchaseRequestIsEditable,
  type PurchaseRequestAbilities,
  type PurchaseRequestKind,
  type PurchaseRequestStatus,
} from "@/lib/erp/purchase-request-workflow";
import { formatDate } from "@/lib/format";

const STATUSES: PurchaseRequestStatus[] = ["Draft", "Open", "Closed", "Cancelled"];

/** The Purchase Request register of one kind, Barang or Jasa (P123). */
export function PurchaseRequestList({
  kind,
  rows,
  can,
}: {
  kind: PurchaseRequestKind;
  rows: PurchaseRequestListRow[];
  can: PurchaseRequestAbilities;
}) {
  const k = PURCHASE_REQUEST_KINDS[kind];
  const goods = kind === "goods";
  return (
    <DocumentRegister
      module="Pembelian"
      icon={goods ? "box" : "tags"}
      title={k.name}
      sub={`Permintaan ${goods ? "barang" : "jasa"} dan kapan dibutuhkan.`}
      base={k.path}
      newLabel={`Buat ${k.name}`}
      canCreate={can.create}
      searchHint="Cari nomor PR atau peminta…"
      statuses={STATUSES}
      statusText={PURCHASE_REQUEST_STATUS_TEXT}
      statusBadge={PURCHASE_REQUEST_STATUS_BADGE}
      columns={[
        { key: "requester", label: "Peminta" },
        { key: "needed", label: "Dibutuhkan", width: 110 },
        ...(goods ? [{ key: "warehouse", label: "Gudang", width: 130 }] : []),
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      empty={`Catat ${goods ? "barang" : "jasa"} yang dibutuhkan, jumlahnya dan kapan dibutuhkan.`}
      rows={rows.map((r) => ({
        id: r.id,
        no: r.requestNo,
        status: r.status,
        date: r.requestDate,
        cells: {
          requester: r.requester,
          needed: formatDate(r.neededDate),
          warehouse: r.warehouseLabel && <span className="lab">{r.warehouseLabel}</span>,
          lines: r.lines,
        },
        search: r.requester ?? undefined,
        editable: can.edit && purchaseRequestIsEditable(r.status),
        steps: rowSteps(availablePurchaseRequestActions(r.status, can), PURCHASE_REQUEST_TRANSITIONS),
      }))}
    />
  );
}
