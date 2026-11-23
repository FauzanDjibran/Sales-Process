"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { StockAdjustmentListRow } from "@/lib/erp/stock-adjustment";
import {
  STOCK_ADJUSTMENT_STATUS_BADGE,
  STOCK_ADJUSTMENT_STATUS_TEXT,
  STOCK_ADJUSTMENT_TRANSITIONS,
  availableStockAdjustmentActions,
  stockAdjustmentIsEditable,
  type StockAdjustmentAbilities,
  type StockAdjustmentStatus,
} from "@/lib/erp/stock-adjustment-workflow";

const STATUSES: StockAdjustmentStatus[] = ["Draft", "Submitted", "Posted", "Rejected", "Cancelled"];

/** The Stock Adjustment register (P318): each count and the net value it moved. */
export function StockAdjustmentList({ rows, can }: { rows: StockAdjustmentListRow[]; can: StockAdjustmentAbilities }) {
  return (
    <DocumentRegister
      module="Persediaan"
      icon="scale"
      title="Stock Adjustment"
      sub="Hitungan fisik gudang Anda dan selisihnya terhadap buku."
      base="/inventory/stock-adjustment"
      newLabel="Buat Stock Adjustment"
      canCreate={can.create}
      searchHint="Cari nomor atau gudang…"
      statuses={STATUSES}
      statusText={STOCK_ADJUSTMENT_STATUS_TEXT}
      statusBadge={STOCK_ADJUSTMENT_STATUS_BADGE}
      columns={[
        { key: "warehouse", label: "Gudang" },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      valueLabel="Selisih"
      empty="Pilih gudang, muat saldonya, lalu isi jumlah fisik yang dihitung."
      rows={rows.map((r) => ({
        id: r.id,
        no: r.no,
        status: r.status,
        date: r.date,
        cells: {
          warehouse: (
            <span className="idc">
              <span className="lab">{r.warehouseLabel}</span>
              <span className="nm">{r.warehouseName}</span>
            </span>
          ),
          lines: r.lines,
        },
        value: r.status === "Posted" ? <Amount value={r.net} ledger /> : null,
        search: [r.warehouseLabel, r.warehouseName].join(" "),
        editable: can.edit && stockAdjustmentIsEditable(r.status),
        steps: rowSteps(availableStockAdjustmentActions(r.status, can), STOCK_ADJUSTMENT_TRANSITIONS),
      }))}
    />
  );
}
