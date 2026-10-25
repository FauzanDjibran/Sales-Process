"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import type { HandoverListRow } from "@/lib/erp/production-handover";
import { HANDOVER_STATUS_BADGE, HANDOVER_STATUS_TEXT, type HandoverAbilities, type HandoverStatus } from "@/lib/erp/production-handover-workflow";

/**
 * The hand-over register (P167). Drafts sort first — goods not yet handed on —
 * then those still in transit, waiting for the receiving workstation, then
 * newest first.
 */
export function HandoverList({ handovers, can }: { handovers: HandoverListRow[]; can: HandoverAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = handovers.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q ||
          o.handoverNo.toLowerCase().includes(q) ||
          (o.orderNo ?? "").toLowerCase().includes(q) ||
          (o.partaiNo ?? "").toLowerCase().includes(q) ||
          o.fromLabel.toLowerCase().includes(q) ||
          o.toLabel.toLowerCase().includes(q))
    );
    const rank = (x: HandoverListRow) => (x.status === "Draft" ? 2 : x.status === "Posted" ? 1 : 0);
    return out.sort((a, b) => rank(b) - rank(a));
  }, [handovers, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <span className="cur">Hand-over (BSTB)</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            Hand-over (BSTB)
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/production/handover/new">
                <Icon name="plus" size={15} /> Hand-over Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Penyerahan barang dari satu Workstation ke berikutnya. Seluruh Partai berpindah bersama; hand-over pertama memulai Partai dan membagi
          barang ke Job. Barang dalam perjalanan sampai Workstation tujuan menerima atau menolaknya. Tidak ada journal.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, Perintah, Partai atau workstation…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Received", "Rejected", "Cancelled"] as HandoverStatus[]).map((s) => ({ value: s, label: HANDOVER_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> hand-over
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
                    <th>Dari</th>
                    <th>Ke</th>
                    <th style={{ width: 210 }}>Partai</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/production/handover/${o.id}`)}>
                      <td>
                        <span className="dstack">
                          <Link className="lab" href={`/production/handover/${o.id}`}>
                            {o.handoverNo}
                          </Link>
                          {o.orderNo && <span className="d2 mono">{o.orderNo}</span>}
                        </span>
                      </td>
                      <td>
                        <span className={`bdg ${HANDOVER_STATUS_BADGE[o.status]}`}>{HANDOVER_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.handoverDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.fromLabel}</span>
                          <span className="nm">{o.fromName}</span>
                        </span>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.toLabel}</span>
                          <span className="nm">{o.toName}</span>
                        </span>
                      </td>
                      <td>{o.partaiNo ? <span className="mono">{o.partaiNo}</span> : <span className="dash">—</span>}</td>
                      <td className="num">{o.lines}</td>
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
              <Icon name="truck" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Hand-over"}</h4>
            <p>
              {q || status
                ? "Tidak ada Hand-over yang sesuai dengan pencarian atau filter."
                : "Hand-over menyerahkan barang di produksi ke Workstation berikutnya: pilih pengirim, tujuan dan barangnya."}
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
                  <Link className="btn primary" href="/production/handover/new">
                    <Icon name="plus" size={15} /> Hand-over Baru
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
