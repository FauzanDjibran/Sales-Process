"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { PermitInvoiceListRow } from "@/lib/erp/permit-invoice";
import {
  INVOICE_PAY_BADGE,
  INVOICE_PAY_TEXT,
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_TEXT,
  PERMIT_INVOICE_TRANSITIONS,
  availableInvoiceActions,
  invoiceIsEditable,
  type InvoiceAbilities,
  type InvoicePayState,
  type InvoiceStatus,
} from "@/lib/erp/ar-invoice-workflow";
import { todayIso } from "@/lib/format";

const STATUSES: InvoiceStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Invoice Perizinan register (P137). */
export function PermitInvoiceList({ rows, can }: { rows: PermitInvoiceListRow[]; can: InvoiceAbilities }) {
  const today = todayIso();
  return (
    <DocumentRegister
      module="Finance"
      icon="file"
      title="Invoice Perizinan"
      sub="Tagihan atas realisasi Pengajuan Perizinan."
      base="/finance/invoice/permit"
      newLabel="Buat Invoice Perizinan"
      canCreate={can.create}
      searchHint="Cari nomor, Pengajuan atau customer…"
      statuses={STATUSES}
      statusText={INVOICE_STATUS_TEXT}
      statusBadge={INVOICE_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="Pengajuan"
      valueLabel="Nilai"
      payment
      empty="Buat invoice dari realisasi perizinan yang belum ditagih."
      rows={rows.map((r) => {
        const state: InvoicePayState = r.paid >= r.total ? "Paid" : r.paid > 0 ? "Partial" : "Unpaid";
        const posted = r.status === "Posted";
        return {
          id: r.id,
          no: r.invoiceNo,
          status: r.status,
          date: r.invoiceDate,
          due: r.dueDate,
          overdue: posted && state !== "Paid" && r.dueDate < today,
          partner: { label: r.customerLabel, name: r.customerName },
          source: { no: r.requestNo, href: `/sales/permit/${r.requestId}` },
          value: <Amount value={r.total} />,
          pay: posted ? { state, text: INVOICE_PAY_TEXT[state], tone: INVOICE_PAY_BADGE[state] } : null,
          search: r.description,
          editable: can.edit && invoiceIsEditable(r.status),
          steps: rowSteps(availableInvoiceActions(r.status, can), PERMIT_INVOICE_TRANSITIONS),
        };
      })}
    />
  );
}
