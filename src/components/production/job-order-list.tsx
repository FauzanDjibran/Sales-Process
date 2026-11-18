"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import type { JobOrderRow } from "@/lib/erp/production-job-order";
import { formatDate, formatNumber } from "@/lib/format";

/** The register of Job Order: newest first. Posted in one step, so no status tabs. No prices (P275). */
export function JobOrderList({ rows: all }: { rows: JobOrderRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!q || [r.no, r.unitLabel, r.partaiNo ?? ""].some((s) => s.toLowerCase().includes(q)))), [all, q]);
  const paging = usePaging(rows, q);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <span className="cur">Job Order</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            Job Order
          </h1>
        </div>
        <p className="ph-sub">Dokumen dibuat dari Persiapan Job Order di Workspace Unit. Tiap Job menjadi No. Stok baru dengan No. Job sendiri.</p>
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, unit, atau partai…" />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> dokumen
          </span>
        </div>
        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={{ width: 250 }}>Nomor</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 160 }}>Unit</th>
                    <th>Partai</th>
                    <th className="num" style={{ width: 110 }}>Job</th>
                    <th className="num" style={{ width: 96 }}>Gram</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/production/job-order/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/production/job-order/${r.id}`} onClick={(e) => e.stopPropagation()}>
                          {r.no}
                        </Link>
                      </td>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <span className="lab">{r.unitLabel}</span> {r.unitName}
                      </td>
                      <td>{r.partaiNo ? <span className="mono">{r.partaiNo}</span> : <span className="dash">—</span>}</td>
                      <td className="num">
                        {r.lines}
                      </td>
                      <td className="num">{r.grams ? formatNumber(r.grams, r.grams % 1 ? 2 : 0) : <span className="dash">—</span>}</td>
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
              <Icon name="clip" size={18} />
            </div>
            <h4>Belum ada dokumen</h4>
            <p>Buka Persiapan Job Order sebuah Unit di Workspace dan klik baris barang.</p>
          </div>
        )}
      </div>
    </>
  );
}
