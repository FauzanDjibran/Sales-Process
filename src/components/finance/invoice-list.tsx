"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { InvoiceListRow } from "@/lib/erp/ar-invoice";
import {
  INVOICE_PAY_BADGE,
  INVOICE_PAY_TEXT,
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_TEXT,
  INVOICE_TRANSITIONS,
  availableInvoiceActions,
  invoiceIsEditable,
  type InvoiceAbilities,
  type InvoiceStatus,
} from "@/lib/erp/ar-invoice-workflow";
import { formatMoney } from "@/lib/format";

const STATUSES: InvoiceStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Invoice Penjualan register (§9). The value is the net Piutang, after the Uang Muka used. */
export function InvoiceList({ rows, can }: { rows: InvoiceListRow[]; can: InvoiceAbilities }) {
  return (
    <DocumentRegister
      module="Finance"
      icon="file"
      title="Invoice Penjualan"
      sub="Tagihan atas barang yang sudah dikirim ke customer."
      base="/finance/invoice/sales"
      newLabel="Buat Invoice Penjualan"
      canCreate={can.create}
      searchHint="Cari nomor invoice, CO atau customer…"
      statuses={STATUSES}
      statusText={INVOICE_STATUS_TEXT}
      statusBadge={INVOICE_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel="Customer Order"
      valueLabel="Nilai"
      payment
      empty="Invoice dibuat dari Customer Order yang barangnya sudah dikirim."
      rows={rows.map((o) => ({
        id: o.id,
        no: o.invoiceNo,
        status: o.status,
        date: o.invoiceDate,
        due: o.dueDate,
        overdue: o.pay?.overdue,
        partner: { label: o.customerLabel, name: o.customerName },
        source: { no: o.customerOrderNo, href: `/sales/customer-order/${o.customerOrderId}` },
        value: <Amount value={o.total} currency={o.currency} />,
        pay: o.pay
          ? {
              state: o.pay.state,
              text: INVOICE_PAY_TEXT[o.pay.state],
              tone: INVOICE_PAY_BADGE[o.pay.state],
              note: o.pay.state === "Partial" ? `sisa ${formatMoney(o.pay.open, o.currency)}` : undefined,
            }
          : null,
        editable: can.edit && invoiceIsEditable(o.status),
        steps: rowSteps(availableInvoiceActions(o.status, can), INVOICE_TRANSITIONS),
      }))}
    />
  );
}
