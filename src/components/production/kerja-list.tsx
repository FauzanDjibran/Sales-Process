"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { KERJA_BADGE, KERJA_STATUS_TEXT, type KerjaStatus } from "@/lib/erp/production-kerja-shape";
import type { KerjaRow } from "@/lib/erp/production-kerja";
import { formatDate, formatNumber } from "@/lib/format";

/** The register of Kerja: status tabs with their counts, newest first. No prices (P275). */
const TABS: [KerjaStatus | "", string][] = [
  ["Running", KERJA_STATUS_TEXT.Running],
  ["Finished", KERJA_STATUS_TEXT.Finished],
  ["Cancelled", KERJA_STATUS_TEXT.Cancelled],
  ["", "Semua"],
];

export function KerjaList({ rows: all }: { rows: KerjaRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(() => (all.some((r) => r.status === "Running") ? "Running" : ""));
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!status || r.status === status) && (!q || [r.no, r.unitLabel, r.partaiNo ?? ""].some((s) => s.toLowerCase().includes(q)))), [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <span className="cur">Kerja</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clock" size={16} />
            </span>
            Kerja
          </h1>
        </div>
        <p className="ph-sub">Dokumen dibuat dari Workspace Unit: Mulai di Persiapan Kerja, Selesai di Sedang Dikerjakan.</p>
      </div>
      <div className="card">
        <div className="qtabs" role="tablist">
          {TABS.map(([s, name]) => (
            <button key={s || "all"} type="button" role="tab" aria-selected={status === s} className={status === s ? "act" : ""} onClick={() => setStatus(s)}>
              {name}
              <span className="n">{all.filter((r) => !s || r.status === s).length}</span>
            </button>
          ))}
        </div>
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
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 160 }}>Unit</th>
                    <th>Partai</th>
                    <th className="num" style={{ width: 110 }}>Berjalan</th>
                    <th className="num" style={{ width: 96 }}>Gram</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/production/kerja/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/production/kerja/${r.id}`} onClick={(e) => e.stopPropagation()}>
                          {r.no}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${KERJA_BADGE[r.status]}`}>{KERJA_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <span className="lab">{r.unitLabel}</span> {r.unitName}
                      </td>
                      <td>{r.partaiNo ? <span className="mono">{r.partaiNo}</span> : <span className="dash">—</span>}</td>
                      <td className="num">
                        {r.open} / {r.lines}
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
              <Icon name="clock" size={18} />
            </div>
            <h4>Belum ada dokumen</h4>
            <p>Buka Persiapan Kerja sebuah Unit di Workspace dan klik baris barang untuk memulai.</p>
          </div>
        )}
      </div>
    </>
  );
}
