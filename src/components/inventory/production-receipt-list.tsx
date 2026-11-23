"use client";

import { DocumentRegister } from "@/components/ui/document-register";
import type { ProductionReceiptRow } from "@/lib/erp/production-receipt";
import {
  PRODUCTION_RECEIPT_PURPOSES,
  PRODUCTION_RECEIPT_STATUS_BADGE,
  PRODUCTION_RECEIPT_STATUS_TEXT,
  type ProductionReceiptPurpose,
  type ProductionReceiptStatus,
} from "@/lib/erp/production-receipt-shape";
import { formatNumber } from "@/lib/format";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const STATUSES: ProductionReceiptStatus[] = ["Submitted", "Posted"];

const TEXT: Record<ProductionReceiptPurpose, { sub: string; empty: string }> = {
  finish_goods: {
    sub: "Barang jadi yang dikirim Unit terakhir ke gudang Anda.",
    empty: "Kiriman dibuat dari Workspace Unit di aplikasi Produksi, lewat Kirim ke Finish Goods.",
  },
  return: {
    sub: "Barang yang dikeluarkan Unit ke gudang Anda, dengan nilai atau tanpa nilai.",
    empty: "BSTB Pengeluaran dibuat dari Workspace Unit di aplikasi Produksi.",
  },
};

/**
 * The register of one purpose of the BSTB from production (P303, P304). Made in
 * the Produksi application; the warehouse only receives, so nothing is created here.
 */
export function ProductionReceiptList({ purpose, rows }: { purpose: ProductionReceiptPurpose; rows: ProductionReceiptRow[] }) {
  const p = PRODUCTION_RECEIPT_PURPOSES[purpose];
  return (
    <DocumentRegister
      module="Persediaan"
      icon="down"
      title={p.name}
      sub={TEXT[purpose].sub}
      base={p.path}
      searchHint="Cari nomor, unit atau gudang…"
      statuses={STATUSES}
      statusText={PRODUCTION_RECEIPT_STATUS_TEXT}
      statusBadge={PRODUCTION_RECEIPT_STATUS_BADGE}
      columns={[
        { key: "unit", label: "Unit Asal" },
        { key: "warehouse", label: "Gudang Tujuan" },
        { key: "lines", label: "Baris", width: 54, num: true },
        { key: "qty", label: "Qty", width: 100, num: true },
      ]}
      empty={TEXT[purpose].empty}
      rows={rows.map((r) => ({
        id: r.id,
        no: r.no,
        status: r.status,
        date: r.date,
        cells: {
          unit: (
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
          lines: r.lines,
          qty: <span className="mny">{qtyText(r.qty)}</span>,
        },
        search: [r.unitLabel, r.unitName, r.warehouseLabel, r.warehouseName].join(" "),
      }))}
    />
  );
}
