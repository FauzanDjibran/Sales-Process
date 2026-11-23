"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { PurchaseOrderListRow } from "@/lib/erp/purchase-order";
import {
  PURCHASE_ORDER_KINDS,
  PURCHASE_ORDER_STATUS_BADGE,
  PURCHASE_ORDER_STATUS_TEXT,
  PURCHASE_ORDER_TRANSITIONS,
  availablePurchaseOrderActions,
  purchaseOrderIsEditable,
  type PurchaseOrderAbilities,
  type PurchaseOrderKind,
  type PurchaseOrderStatus,
} from "@/lib/erp/purchase-order-workflow";
import { formatDate } from "@/lib/format";

const STATUSES: PurchaseOrderStatus[] = ["Draft", "Submitted", "Open", "Closed", "Cancelled", "Rejected"];

/** The Purchase Order register of one kind, Barang or Jasa (P124). */
export function PurchaseOrderList({ kind, rows, can }: { kind: PurchaseOrderKind; rows: PurchaseOrderListRow[]; can: PurchaseOrderAbilities }) {
  const k = PURCHASE_ORDER_KINDS[kind];
  const goods = kind === "goods";
  return (
    <DocumentRegister
      module="Pembelian"
      icon={goods ? "clip" : "tags"}
      title={k.name}
      sub={`Pesanan ${goods ? "barang" : "jasa"} ke satu supplier, dengan harga dan pajaknya.`}
      base={k.path}
      newLabel={`Buat ${k.name}`}
      canCreate={can.create}
      searchHint="Cari nomor PO, PR atau supplier…"
      statuses={STATUSES}
      statusText={PURCHASE_ORDER_STATUS_TEXT}
      statusBadge={PURCHASE_ORDER_STATUS_BADGE}
      partnerLabel="Supplier"
      sourceLabel="Purchase Request"
      columns={[
        { key: "delivery", label: "Tgl Kirim", width: 90 },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      valueLabel="Nilai"
      empty={`Pesan ${goods ? "barang" : "jasa"} dari Purchase Request yang Open ke satu supplier.`}
      rows={rows.map((r) => ({
        id: r.id,
        no: r.orderNo,
        status: r.status,
        date: r.orderDate,
        partner: { label: r.supplierLabel, name: r.supplierName },
        source: r.requests.length
          ? {
              no: r.requests[0].no,
              href: `/purchasing/request/${kind}/${r.requests[0].id}`,
              note: r.requests.length > 1 ? `+${r.requests.length - 1} lainnya` : undefined,
            }
          : null,
        cells: { delivery: formatDate(r.deliveryDate), lines: r.lines },
        value: <Amount value={r.total} currency={r.currency} />,
        search: r.requests.map((q) => q.no).join(" "),
        editable: can.edit && purchaseOrderIsEditable(r.status),
        steps: rowSteps(availablePurchaseOrderActions(r.status, can), PURCHASE_ORDER_TRANSITIONS),
      }))}
    />
  );
}
