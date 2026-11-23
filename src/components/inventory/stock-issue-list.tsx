"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { StockIssueListRow } from "@/lib/erp/stock-issue";
import {
  STOCK_ISSUE_STATUS_BADGE,
  STOCK_ISSUE_STATUS_TEXT,
  STOCK_ISSUE_TRANSITIONS,
  availableStockIssueActions,
  stockIssueIsEditable,
  type StockIssueAbilities,
  type StockIssueStatus,
} from "@/lib/erp/stock-issue-workflow";

const STATUSES: StockIssueStatus[] = ["Draft", "Submitted", "Posted", "Cancelled"];

/** The BSTB Issue register (R4). The value is what a received issue moved from Persediaan to WIP. */
export function StockIssueList({ issues, can }: { issues: StockIssueListRow[]; can: StockIssueAbilities }) {
  const units = [...new Map(issues.filter((o) => o.unitLabel).map((o) => [o.unitLabel, o.unitName])).entries()];
  return (
    <DocumentRegister
      module="Persediaan"
      icon="layers"
      title="BSTB Issue"
      sub="Bahan dan bahan penolong keluar dari gudang ke Unit, per lot."
      base="/inventory/stock-issue"
      newLabel="Buat BSTB Issue"
      canCreate={can.create}
      searchHint="Cari nomor, gudang atau unit…"
      statuses={STATUSES}
      statusText={STOCK_ISSUE_STATUS_TEXT}
      statusBadge={STOCK_ISSUE_STATUS_BADGE}
      columns={[
        { key: "warehouse", label: "Gudang" },
        { key: "unit", label: "Unit" },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      valueLabel="Nilai ke WIP"
      facets={[{ key: "unit", label: "Unit", options: units.map(([label, name]) => ({ value: label, label: `${label} · ${name}` })) }]}
      empty="Keluarkan bahan dari gudang ke produksi: pilih gudang, Unit, barang dan lotnya."
      rows={issues.map((o) => ({
        id: o.id,
        no: o.issueNo,
        status: o.status,
        date: o.issueDate,
        cells: {
          warehouse: (
            <span className="idc">
              <span className="lab">{o.warehouseLabel}</span>
              <span className="nm">{o.warehouseName}</span>
            </span>
          ),
          unit: (
            <span className="idc">
              <span className="lab">{o.unitLabel}</span>
              <span className="nm">{o.unitName}</span>
            </span>
          ),
          lines: o.lines,
        },
        value: o.status === "Posted" ? <Amount value={o.cost} /> : null,
        facets: { unit: o.unitLabel },
        search: [o.warehouseLabel, o.warehouseName, o.unitLabel, o.unitName].join(" "),
        editable: can.edit && stockIssueIsEditable(o.status),
        steps: rowSteps(availableStockIssueActions(o.status, can), STOCK_ISSUE_TRANSITIONS),
      }))}
    />
  );
}
