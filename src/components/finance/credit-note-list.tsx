"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { CreditNoteListRow } from "@/lib/erp/ar-credit-note";
import {
  CREDIT_NOTE_STATUS_BADGE,
  CREDIT_NOTE_STATUS_TEXT,
  CREDIT_NOTE_TRANSITIONS,
  availableCreditNoteActions,
  creditNoteIsEditable,
  type CreditNoteAbilities,
  type CreditNoteStatus,
} from "@/lib/erp/ar-credit-note-workflow";

const STATUSES: CreditNoteStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Credit Note Penjualan register (P292). */
export function CreditNoteList({ rows, can }: { rows: CreditNoteListRow[]; can: CreditNoteAbilities }) {
  return (
    <DocumentRegister
      module="Finance"
      icon="file"
      title="Credit Note Penjualan"
      sub="Pengurang tagihan atas barang yang kembali setelah Invoice diposting."
      base="/finance/invoice/credit-note"
      newLabel="Buat Credit Note Penjualan"
      canCreate={can.create}
      searchHint="Cari nomor, Invoice atau customer…"
      statuses={STATUSES}
      statusText={CREDIT_NOTE_STATUS_TEXT}
      statusBadge={CREDIT_NOTE_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="Invoice"
      columns={[{ key: "lines", label: "Baris", width: 54, num: true }]}
      valueLabel="Nilai"
      empty="Credit Note dibuat dari Invoice Penjualan yang barangnya kembali setelah ditagih."
      rows={rows.map((o) => ({
        id: o.id,
        no: o.creditNo,
        status: o.status,
        date: o.creditDate,
        partner: { label: o.customerLabel, name: o.customerName },
        source: { no: o.invoiceNo, href: `/finance/invoice/sales/${o.invoiceId}` },
        cells: { lines: o.lines },
        value: <Amount value={o.total} currency={o.currency} />,
        editable: can.edit && creditNoteIsEditable(o.status),
        steps: rowSteps(availableCreditNoteActions(o.status, can), CREDIT_NOTE_TRANSITIONS),
      }))}
    />
  );
}
