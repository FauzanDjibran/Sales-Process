"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { StockIssueListRow } from "@/lib/erp/stock-issue";
import { STOCK_ISSUE_STATUS_BADGE, STOCK_ISSUE_STATUS_TEXT, type StockIssueAbilities, type StockIssueStatus } from "@/lib/erp/stock-issue-workflow";

/**
 * The Stock Issue register (P158). Drafts sort first — goods not yet booked
 * out — then newest first. The value column is what each posted issue moved
 * from Persediaan to WIP; a Draft has none yet.
 */
export function StockIssueList({ issues, can }: { issues: StockIssueListRow[]; can: StockIssueAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = issues.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q ||
          o.issueNo.toLowerCase().includes(q) ||
          o.warehouseLabel.toLowerCase().includes(q) ||
          o.warehouseName.toLowerCase().includes(q) ||
          o.workstationLabel.toLowerCase().includes(q) ||
          o.workstationName.toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [issues, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Persediaan</span>
          <span>/</span>
          <span className="cur">Stock Issue</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="layers" size={16} />
            </span>
            Stock Issue
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/inventory/stock-issue/new">
                <Icon name="plus" size={15} /> Stock Issue Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Barang keluar dari gudang untuk dipakai sendiri — ke produksi: bahan per lot ke sebuah Workstation, dengan nomor lot yang sama.
          Posting memindahkan nilainya dari Persediaan ke WIP.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, gudang atau workstation…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as StockIssueStatus[]).map((s) => ({ value: s, label: STOCK_ISSUE_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> stock issue
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th>Gudang</th>
                    <th>Workstation</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                    <th className="num" style={{ width: 150 }}>Nilai ke WIP</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/inventory/stock-issue/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/inventory/stock-issue/${o.id}`}>
                          {o.issueNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${STOCK_ISSUE_STATUS_BADGE[o.status]}`}>{STOCK_ISSUE_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.issueDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.warehouseLabel}</span>
                          <span className="nm">{o.warehouseName}</span>
                        </span>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.workstationLabel}</span>
                          <span className="nm">{o.workstationName}</span>
                        </span>
                      </td>
                      <td className="num">{o.lines}</td>
                      <td className="num">
                        {o.status === "Posted" ? <span className="mny">{formatMoney(o.cost, "IDR")}</span> : <span className="dash">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={paging.page} pages={paging.pages} total={paging.total} perPage={paging.perPage} onPage={paging.setPage} onPerPage={paging.setPerPage} />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="layers" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Stock Issue"}</h4>
            <p>
              {q || status
                ? "Tidak ada Stock Issue yang sesuai dengan pencarian atau filter."
                : "Stock Issue mengeluarkan bahan dari gudang ke produksi: pilih gudang, Workstation, barang dan lotnya."}
            </p>
            {q || status ? (
              <div className="cta">
                <button
                  className="btn"
                  onClick={() => {
                    setQuery("");
                    setStatus("");
                  }}
                >
                  Bersihkan filter
                </button>
              </div>
            ) : (
              can.create && (
                <div className="cta">
                  <Link className="btn primary" href="/inventory/stock-issue/new">
                    <Icon name="plus" size={15} /> Stock Issue Baru
                  </Link>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </>
  );
}
