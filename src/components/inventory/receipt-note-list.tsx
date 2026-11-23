"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import { documentHref } from "@/lib/erp/document-links";
import type { ReceiptNoteListRow } from "@/lib/erp/receipt-note";
import {
  RECEIPT_NOTE_STATUS_BADGE,
  RECEIPT_NOTE_STATUS_TEXT,
  RECEIPT_NOTE_TRANSITIONS,
  availableReceiptNoteActions,
  receiptNoteIsEditable,
  type ReceiptNoteAbilities,
  type ReceiptNoteStatus,
} from "@/lib/erp/receipt-note-workflow";

const STATUSES: ReceiptNoteStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Receipt Note register (P125): receipts from suppliers and returns from customers. */
export function ReceiptNoteList({ rows, can }: { rows: ReceiptNoteListRow[]; can: ReceiptNoteAbilities }) {
  return (
    <DocumentRegister
      module="Persediaan"
      icon="box"
      title="Receipt Note"
      sub="Penerimaan barang atau jasa dari supplier, dan barang retur dari customer."
      base="/inventory/receipt-note"
      newLabel="Buat Receipt Note"
      canCreate={can.create}
      moreActions={
        can.create && (
          <Link className="btn" href="/inventory/receipt-note/new?purpose=sales_return">
            <Icon name="plus" size={15} /> Penerimaan Retur
          </Link>
        )
      }
      searchHint="Cari nomor RN, sumber atau partner…"
      statuses={STATUSES}
      statusText={RECEIPT_NOTE_STATUS_TEXT}
      statusBadge={RECEIPT_NOTE_STATUS_BADGE}
      partnerLabel="Partner"
      sourceLabel="Dokumen Sumber"
      columns={[
        { key: "warehouse", label: "Gudang", width: 90 },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      valueLabel="Nilai"
      facets={[{ key: "kind", label: "Jenis", options: [{ value: "purchase", label: "Pembelian" }, { value: "return", label: "Retur" }] }]}
      empty="Catat barang atau jasa yang diterima dari Purchase Order yang Open."
      rows={rows.map((r) => ({
        id: r.id,
        no: r.rnNo,
        status: r.status,
        date: r.rnDate,
        partner: { label: r.supplierLabel, name: r.supplierName },
        source: { no: r.sourceNo, href: documentHref(r.isReturn ? "sal_return" : "pur_order", r.sourceId) ?? undefined },
        cells: { warehouse: r.warehouseLabel && <span className="lab">{r.warehouseLabel}</span>, lines: r.lines },
        value: r.status === "Posted" ? <Amount value={r.value} /> : null,
        facets: { kind: r.isReturn ? "return" : "purchase" },
        editable: can.edit && receiptNoteIsEditable(r.status),
        steps: rowSteps(availableReceiptNoteActions(r.status, can), RECEIPT_NOTE_TRANSITIONS),
      }))}
    />
  );
}
