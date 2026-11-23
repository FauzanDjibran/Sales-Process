"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { PurchaseInvoiceListRow } from "@/lib/erp/ap-invoice";
import {
  INVOICE_PAY_BADGE,
  INVOICE_PAY_TEXT,
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_TEXT,
  PURCHASE_INVOICE_TRANSITIONS,
  availablePurchaseInvoiceActions,
  invoiceIsEditable,
  type InvoiceAbilities,
  type InvoiceStatus,
} from "@/lib/erp/ap-invoice-workflow";
import { formatMoney } from "@/lib/format";

const STATUSES: InvoiceStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Invoice Pembelian register (P128). */
export function PurchaseInvoiceList({ rows, can }: { rows: PurchaseInvoiceListRow[]; can: InvoiceAbilities }) {
  return (
    <DocumentRegister
      module="Finance"
      icon="file"
      title="Invoice Pembelian"
      sub="Tagihan supplier atas barang dan jasa yang sudah diterima."
      base="/finance/invoice/purchase"
      newLabel="Buat Invoice Pembelian"
      canCreate={can.create}
      searchHint="Cari nomor, invoice supplier, PO atau supplier…"
      statuses={STATUSES}
      statusText={INVOICE_STATUS_TEXT}
      statusBadge={INVOICE_STATUS_BADGE}
      partnerLabel="Supplier"
      sourceLabel="Purchase Order"
      valueLabel="Nilai"
      payment
      empty="Catat tagihan supplier dari baris Receipt Note yang sudah diposting."
      rows={rows.map((o) => ({
        id: o.id,
        no: o.invoiceNo,
        status: o.status,
        date: o.invoiceDate,
        due: o.dueDate,
        overdue: o.pay?.overdue,
        partner: { label: o.supplierLabel, name: o.supplierName },
        source: { no: o.orderNo, href: `/purchasing/order/goods/${o.orderId}`, note: `inv. ${o.supplierInvoiceNo}` },
        value: <Amount value={o.total} currency={o.currency} />,
        pay: o.pay
          ? {
              state: o.pay.state,
              text: INVOICE_PAY_TEXT[o.pay.state],
              tone: INVOICE_PAY_BADGE[o.pay.state],
              note: o.pay.state === "Partial" ? `sisa ${formatMoney(o.pay.open, o.currency)}` : undefined,
            }
          : null,
        search: o.supplierInvoiceNo,
        editable: can.edit && invoiceIsEditable(o.status),
        steps: rowSteps(availablePurchaseInvoiceActions(o.status, can), PURCHASE_INVOICE_TRANSITIONS),
      }))}
    />
  );
}
