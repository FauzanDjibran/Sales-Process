"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { RunListRow } from "@/lib/erp/production-run";
import { EXECUTION_KIND_TEXT, EXECUTION_STATUS_BADGE, EXECUTION_STATUS_TEXT, type ExecutionAbilities, type ExecutionStatus } from "@/lib/erp/production-run-workflow";

/** The Eksekusi Produksi register (P169): Drafts first — work not yet booked — then newest first. */
export function RunList({ runs, can }: { runs: RunListRow[]; can: ExecutionAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = runs.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q || o.executionNo.toLowerCase().includes(q) || (o.partaiNo ?? "").toLowerCase().includes(q) || o.stationLabel.toLowerCase().includes(q) || o.stationName.toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [runs, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <span className="cur">Eksekusi Produksi</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="gear" size={16} />
            </span>
            Eksekusi Produksi
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/production/execution/new">
                <Icon name="plus" size={15} /> Eksekusi Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Pengerjaan di satu Workstation, satu section per Job: input menjadi output (lot baru), atau lot tetap pada pass-through, atau mix Moulding.
          Nilai ikut barang ditambah biaya standar workstation; journal ke WIP.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, Partai atau workstation…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[{ value: "", label: "Status: semua" }, ...(["Draft", "Posted", "Cancelled"] as ExecutionStatus[]).map((s) => ({ value: s, label: EXECUTION_STATUS_TEXT[s] }))]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> eksekusi
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
                    <th style={{ width: 170 }}>Jenis</th>
                    <th style={{ width: 200 }}>Partai</th>
                    <th className="num" style={{ width: 90 }}>
                      Section
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Nilai Output
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/production/execution/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/production/execution/${o.id}`}>
                          {o.executionNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${EXECUTION_STATUS_BADGE[o.status]}`}>{EXECUTION_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.executionDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.stationLabel}</span>
                          <span className="nm">{o.stationName}</span>
                        </span>
                      </td>
                      <td>{EXECUTION_KIND_TEXT[o.kind]}</td>
                      <td>{o.partaiNo ? <span className="mono">{o.partaiNo}</span> : <span className="dash">—</span>}</td>
                      <td className="num">{o.sections}</td>
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
              <Icon name="gear" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Eksekusi Produksi"}</h4>
            <p>{q || status ? "Tidak ada eksekusi yang sesuai dengan pencarian atau filter." : "Eksekusi mengerjakan barang yang sudah diterima Workstation: pilih Workstation, input dan outputnya."}</p>
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
                  <Link className="btn primary" href="/production/execution/new">
                    <Icon name="plus" size={15} /> Eksekusi Baru
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
