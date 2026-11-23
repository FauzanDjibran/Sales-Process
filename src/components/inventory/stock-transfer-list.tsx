"use client";

import { DocumentRegister } from "@/components/ui/document-register";
import type { StockTransferListRow } from "@/lib/erp/stock-transfer";
import type { TransferReceiptListRow } from "@/lib/erp/stock-transfer-receipt";
import {
  STOCK_TRANSFER_RECEIPT_STATUS_BADGE,
  STOCK_TRANSFER_RECEIPT_STATUS_TEXT,
  STOCK_TRANSFER_STATUS_BADGE,
  STOCK_TRANSFER_STATUS_TEXT,
  type StockTransferReceiptStatus,
  type StockTransferStatus,
} from "@/lib/erp/stock-transfer-workflow";
import { formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const place = (label: string, name: string) => (
  <span className="idc">
    <span className="lab">{label}</span>
    <span className="nm">{name}</span>
  </span>
);
const COLUMNS = [
  { key: "from", label: "Gudang Asal" },
  { key: "to", label: "Gudang Tujuan" },
  { key: "lines", label: "Baris", width: 54, num: true },
  { key: "qty", label: "Qty", width: 100, num: true },
];

/**
 * The registers of Transfer Kirim and Transfer Terima (P300). The rows are
 * already narrowed to the user's warehouses in the database (OD-9). Who may act
 * on a row depends on its warehouse, so the steps stay on the document's page.
 */
export function StockTransferList({ transfers, canCreate }: { transfers: StockTransferListRow[]; canCreate: boolean }) {
  const statuses: StockTransferStatus[] = ["Draft", "InTransit", "Received", "Cancelled"];
  return (
    <DocumentRegister
      module="Persediaan"
      icon="send"
      title="Transfer Kirim"
      sub="Stok yang dikirim dari satu gudang ke gudang lain."
      base="/inventory/stock-transfer"
      newLabel="Buat Transfer Kirim"
      canCreate={canCreate}
      searchHint="Cari nomor atau gudang…"
      statuses={statuses}
      statusText={STOCK_TRANSFER_STATUS_TEXT}
      statusBadge={STOCK_TRANSFER_STATUS_BADGE}
      statusWidth={136}
      columns={COLUMNS}
      empty="Pindahkan stok dari gudang Anda: pilih gudang tujuan, barang dan lotnya."
      rows={transfers.map((t) => ({
        id: t.id,
        no: t.transferNo,
        status: t.status,
        date: t.transferDate,
        cells: { from: place(t.fromLabel, t.fromName), to: place(t.toLabel, t.toName), lines: t.lines, qty: <span className="mny">{qtyText(t.qty)}</span> },
        search: [t.fromLabel, t.fromName, t.toLabel, t.toName].join(" "),
      }))}
    />
  );
}

export function TransferReceiptList({ receipts, canCreate }: { receipts: TransferReceiptListRow[]; canCreate: boolean }) {
  const statuses: StockTransferReceiptStatus[] = ["Draft", "Posted", "Cancelled"];
  return (
    <DocumentRegister
      module="Persediaan"
      icon="down"
      title="Transfer Terima"
      sub="Penerimaan Transfer Kirim di gudang tujuan, boleh bertahap."
      base="/inventory/stock-transfer-receipt"
      newLabel="Buat Transfer Terima"
      canCreate={canCreate}
      searchHint="Cari nomor, Transfer Kirim atau gudang…"
      statuses={statuses}
      statusText={STOCK_TRANSFER_RECEIPT_STATUS_TEXT}
      statusBadge={STOCK_TRANSFER_RECEIPT_STATUS_BADGE}
      sourceLabel="Transfer Kirim"
      columns={COLUMNS}
      empty="Catat barang dari Transfer Kirim yang tiba di gudang Anda."
      rows={receipts.map((r) => ({
        id: r.id,
        no: r.receiptNo,
        status: r.status,
        date: r.receiptDate,
        source: { no: r.transferNo, href: `/inventory/stock-transfer/${r.transferId}` },
        cells: { from: place(r.fromLabel, r.fromName), to: place(r.toLabel, r.toName), lines: r.lines, qty: <span className="mny">{qtyText(r.qty)}</span> },
        search: [r.fromLabel, r.fromName, r.toLabel, r.toName].join(" "),
      }))}
    />
  );
}
