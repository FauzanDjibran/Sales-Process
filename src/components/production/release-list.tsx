"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { ReleaseListRow } from "@/lib/erp/production-release";
import { RELEASE_PURPOSES, RELEASE_STATUS_BADGE, RELEASE_STATUS_TEXT, type ReleaseAbilities, type ReleasePurpose, type ReleaseStatus } from "@/lib/erp/production-release-workflow";

/** The register of one purpose — Penerimaan Hasil Produksi or Pemusnahan Produksi (P170): Drafts first, then newest first. */
export function ReleaseList({ purpose, rows: all, can }: { purpose: ReleasePurpose; rows: ReleaseListRow[]; can: ReleaseAbilities }) {
  const router = useRouter();
  const def = RELEASE_PURPOSES[purpose];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (o) => (!status || o.status === status) && (!q || o.releaseNo.toLowerCase().includes(q) || o.stationLabel.toLowerCase().includes(q) || o.stationName.toLowerCase().includes(q) || (o.warehouseLabel ?? "").toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <span className="cur">{def.name}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name={def.icon} size={16} />
            </span>
            {def.name}
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href={`${def.path}/new`}>
                <Icon name="plus" size={15} /> {def.name} Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          {def.lead} Journal {def.journalText}.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder={def.needsWarehouse ? "Cari nomor, workstation atau gudang…" : "Cari nomor atau workstation…"} />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[{ value: "", label: "Status: semua" }, ...(["Draft", "Posted", "Cancelled"] as ReleaseStatus[]).map((s) => ({ value: s, label: RELEASE_STATUS_TEXT[s] }))]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> dokumen
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 230 }}>Nomor</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th>Workstation</th>
                    {def.needsWarehouse && <th style={{ width: 160 }}>Gudang</th>}
                    <th className="num" style={{ width: 80 }}>
                      Baris
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Nilai
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`${def.path}/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`${def.path}/${o.id}`}>
                          {o.releaseNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${RELEASE_STATUS_BADGE[o.status]}`}>{RELEASE_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.releaseDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.stationLabel}</span>
                          <span className="nm">{o.stationName}</span>
                        </span>
                      </td>
                      {def.needsWarehouse && <td>{o.warehouseLabel ? <span className="lab">{o.warehouseLabel}</span> : <span className="dash">—</span>}</td>}
                      <td className="num">{o.lines}</td>
                      <td className="num">{o.status === "Posted" ? <span className="mny">{formatMoney(o.totalValue, "IDR")}</span> : <span className="dash">—</span>}</td>
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
              <Icon name={def.icon} size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : `Belum ada ${def.name}`}</h4>
            <p>{q || status ? "Tidak ada dokumen yang sesuai dengan pencarian atau filter." : def.lead}</p>
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
                  <Link className="btn primary" href={`${def.path}/new`}>
                    <Icon name="plus" size={15} /> {def.name} Baru
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
