"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { HANDOVER_STATUS_BADGE, type HandoverStatus } from "@/lib/erp/production-handover-shape";
import { formatDate } from "@/lib/format";

export type HandoverRow = { id: number; no: string; purpose: string; date: string; status: HandoverStatus; unitLabel: string; warehouseName: string; lines: number };

/** The register of Production Receipt or Production Issue (P317): status tabs, newest first. No prices (P275). */
export function HandoverList({ title, sub, icon, base, statusText, warehouseHead, rows: all }: { title: string; sub: string; icon: IconName; base: string; statusText: Record<HandoverStatus, string>; warehouseHead: string; rows: HandoverRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(() => (all.some((r) => r.status === "InTransit") ? "InTransit" : ""));
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!status || r.status === status) && (!q || [r.no, r.purpose, r.unitLabel, r.warehouseName].some((s) => s.toLowerCase().includes(q)))), [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);
  const tabs: [HandoverStatus | "", string][] = [
    ["InTransit", statusText.InTransit],
    ["Received", statusText.Received],
    ["", "Semua"],
  ];
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <span className="cur">{title}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={icon} size={16} />
            </span>
            {title}
          </h1>
        </div>
        <p className="ph-sub">{sub}</p>
      </div>
      <div className="card">
        <div className="qtabs" role="tablist">
          {tabs.map(([s, name]) => (
            <button key={s || "all"} type="button" role="tab" aria-selected={status === s} className={status === s ? "act" : ""} onClick={() => setStatus(s)}>
              {name}
              <span className="n">{all.filter((r) => !s || r.status === s).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, tujuan, unit atau gudang…" />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> dokumen
          </span>
        </div>
        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 250 }}>Nomor</th>
                    <th>Tujuan</th>
                    <th style={{ width: 140 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 90 }}>Unit</th>
                    <th style={{ width: 180 }}>{warehouseHead}</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`${base}/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`${base}/${r.id}`} onClick={(e) => e.stopPropagation()}>
                          {r.no}
                        </Link>
                      </td>
                      <td>{r.purpose}</td>
                      <td>
                        <span className={`bdg ${HANDOVER_STATUS_BADGE[r.status]}`}>{statusText[r.status]}</span>
                      </td>
                      <td>{formatDate(r.date)}</td>
                      <td className="mono">{r.unitLabel}</td>
                      <td>{r.warehouseName}</td>
                      <td className="num">{r.lines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={paging.page} pages={paging.pages} total={paging.total} perPage={paging.perPage} onPage={paging.setPage} onPerPage={paging.setPerPage} />
          </>
        ) : (
          <div className="empty">
            <h4>Tidak ada dokumen</h4>
            <p>{q || status ? "Ubah pencarian atau tab." : sub}</p>
          </div>
        )}
      </div>
    </>
  );
}
