"use client";

import Link from "next/link";
import { Amount } from "@/components/ui/amount";
import { DocumentRegister } from "@/components/ui/document-register";
import type { StockReceiptRow } from "@/lib/erp/stock-receipt";
import {
  STOCK_RECEIPT_PATH,
  STOCK_RECEIPT_PURPOSES,
  STOCK_RECEIPT_STATUS_BADGE,
  STOCK_RECEIPT_STATUS_TEXT,
  type StockReceiptPurposeKey,
  type StockReceiptStatus,
} from "@/lib/erp/stock-receipt-purposes";

const STATUSES: StockReceiptStatus[] = ["InTransit", "Received"];

/**
 * The Stock Receipt register (P317). What production sends is only taken in
 * here, and a Bonus Pembelian comes with its Receipt Note (P321), so nothing is
 * created here.
 */
export function StockReceiptList({ rows }: { rows: StockReceiptRow[] }) {
  return (
    <DocumentRegister
      module="Persediaan"
      icon="down"
      title="Stock Receipt"
      sub="Barang masuk gudang Anda tanpa partner, menurut tujuannya."
      base={STOCK_RECEIPT_PATH}
      searchHint="Cari nomor, tujuan, unit atau gudang…"
      statuses={STATUSES}
      statusText={STOCK_RECEIPT_STATUS_TEXT}
      statusBadge={STOCK_RECEIPT_STATUS_BADGE}
      columns={[
        { key: "purpose", label: "Tujuan", width: 170 },
        { key: "unit", label: "Asal" },
        { key: "warehouse", label: "Gudang" },
        { key: "lots", label: "No. Stok", width: 76, num: true },
      ]}
      valueLabel="Nilai"
      facets={[{ key: "purpose", label: "Tujuan", options: (Object.keys(STOCK_RECEIPT_PURPOSES) as StockReceiptPurposeKey[]).map((k) => ({ value: k, label: STOCK_RECEIPT_PURPOSES[k].name })) }]}
      empty="Kiriman dari produksi muncul di sini setelah Unit menekan Kirim di Workspace."
      rows={rows.map((r) => ({
        id: r.id,
        no: r.no,
        status: r.status,
        date: r.date,
        cells: {
          purpose: STOCK_RECEIPT_PURPOSES[r.purpose].name,
          unit: r.sourceId ? (
            <Link className="drl" href={`/inventory/receipt-note/${r.sourceId}`}>
              <span className="mono">{r.sourceNo}</span>
            </Link>
          ) : (
            <span className="idc">
              <span className="lab">{r.unitLabel}</span>
              <span className="nm">{r.unitName}</span>
            </span>
          ),
          warehouse: (
            <span className="idc">
              <span className="lab">{r.warehouseLabel}</span>
              <span className="nm">{r.warehouseName}</span>
            </span>
          ),
          lots: r.lots,
        },
        value: <Amount value={r.cost} />,
        facets: { purpose: r.purpose },
        search: [STOCK_RECEIPT_PURPOSES[r.purpose].name, r.sourceNo ?? "", r.unitLabel, r.unitName, r.warehouseLabel, r.warehouseName].join(" "),
      }))}
    />
  );
}
