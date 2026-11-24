"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { StockIssueListRow } from "@/lib/erp/stock-issue";
import { STOCK_ISSUE_PURPOSES, stockIssuePurpose } from "@/lib/erp/stock-issue-purposes";
import {
  STOCK_ISSUE_STATUS_BADGE,
  STOCK_ISSUE_STATUS_TEXT,
  availableStockIssueActions,
  stockIssueIsEditable,
  stockIssueTransitions,
  type StockIssueAbilities,
  type StockIssueStatus,
} from "@/lib/erp/stock-issue-workflow";

const STATUSES: StockIssueStatus[] = ["Draft", "InTransit", "Received", "Posted", "Cancelled"];

/** The Stock Issue register (R4, P317). The value is what a sent issue moved from Persediaan to WIP or to expense. */
export function StockIssueList({ issues, can }: { issues: StockIssueListRow[]; can: StockIssueAbilities }) {
  const units = [...new Map(issues.filter((o) => o.unitLabel).map((o) => [o.unitLabel, o.unitName])).entries()];
  return (
    <DocumentRegister
      module="Persediaan"
      icon="layers"
      title="Stock Issue"
      sub="Barang keluar dari gudang Anda tanpa partner, menurut tujuannya."
      base="/inventory/stock-issue"
      newLabel="Buat Stock Issue"
      canCreate={can.create}
      searchHint="Cari nomor, tujuan, gudang atau unit…"
      statuses={STATUSES}
      statusText={STOCK_ISSUE_STATUS_TEXT}
      statusBadge={STOCK_ISSUE_STATUS_BADGE}
      columns={[
        { key: "purpose", label: "Tujuan", width: 170 },
        { key: "warehouse", label: "Gudang" },
        { key: "unit", label: "Unit" },
        { key: "lines", label: "Baris", width: 54, num: true },
      ]}
      valueLabel="Nilai"
      facets={[
        { key: "purpose", label: "Tujuan", options: STOCK_ISSUE_PURPOSES.map((p) => ({ value: p.key, label: p.name })) },
        { key: "unit", label: "Unit", options: units.map(([label, name]) => ({ value: label, label: `${label} · ${name}` })) },
      ]}
      empty="Keluarkan barang dari gudang: pilih tujuan, gudang, barang dan lotnya."
      rows={issues.map((o) => ({
        id: o.id,
        no: o.issueNo,
        status: o.status,
        date: o.issueDate,
        cells: {
          purpose: stockIssuePurpose(o.purpose)?.name ?? o.purpose,
          warehouse: (
            <span className="idc">
              <span className="lab">{o.warehouseLabel}</span>
              <span className="nm">{o.warehouseName}</span>
            </span>
          ),
          unit: o.unitLabel ? (
            <span className="idc">
              <span className="lab">{o.unitLabel}</span>
              <span className="nm">{o.unitName}</span>
            </span>
          ) : (
            <span className="dash">—</span>
          ),
          lines: o.lines,
        },
        value: o.status !== "Draft" && o.status !== "Cancelled" ? <Amount value={o.cost} /> : null,
        facets: { purpose: o.purpose, unit: o.unitLabel },
        search: [stockIssuePurpose(o.purpose)?.name ?? "", o.warehouseLabel, o.warehouseName, o.unitLabel, o.unitName].join(" "),
        editable: can.edit && stockIssueIsEditable(o.status),
        steps: rowSteps(availableStockIssueActions(o.status, can), stockIssueTransitions(o.purpose)),
      }))}
    />
  );
}
