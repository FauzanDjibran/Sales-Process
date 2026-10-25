"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import type { PlanListRow } from "@/lib/erp/production-plan";
import {
  PRODUCTION_PLAN_STATUS_BADGE,
  PRODUCTION_PLAN_STATUS_TEXT,
  type ProductionPlanAbilities,
  type ProductionPlanStatus,
} from "@/lib/erp/production-plan-workflow";
import { periodText } from "@/lib/erp/production-plan-shape";

/** The Rencana Produksi register (P168): drafts and those awaiting approval first, then by month, newest first. */
export function ProductionPlanList({ plans, can }: { plans: PlanListRow[]; can: ProductionPlanAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = plans.filter((o) => (!status || o.status === status) && (!q || o.planNo.toLowerCase().includes(q) || periodText(o.period).toLowerCase().includes(q)));
    const rank = (x: PlanListRow) => (x.status === "Draft" ? 2 : x.status === "Submitted" ? 1 : 0);
    return out.sort((a, b) => rank(b) - rank(a));
  }, [plans, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <span className="cur">Rencana Produksi</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="cal" size={16} />
            </span>
            Rencana Produksi
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/production/plan/new">
                <Icon name="plus" size={15} /> Rencana Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Rencana PPIC untuk satu bulan — dibuat akhir bulan sebelumnya: barang, jumlah dan tanggal mulai, dari baris Sales Order yang Open.
          Perintah Produksi dirilis dari rencana yang disetujui. Tidak memposting apa pun.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor atau bulan…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Submitted", "Open", "Closed", "Rejected", "Cancelled"] as ProductionPlanStatus[]).map((s) => ({ value: s, label: PRODUCTION_PLAN_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> rencana
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 190 }}>Nomor</th>
                    <th style={{ width: 130 }}>Status</th>
                    <th>Bulan</th>
                    <th style={{ width: 110 }}>Tanggal</th>
                    <th className="num" style={{ width: 90 }}>
                      Barang
                    </th>
                    <th className="num" style={{ width: 90 }}>
                      Baris
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/production/plan/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/production/plan/${o.id}`}>
                          {o.planNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${PRODUCTION_PLAN_STATUS_BADGE[o.status]}`}>{PRODUCTION_PLAN_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{periodText(o.period)}</td>
                      <td>{formatDate(o.planDate)}</td>
                      <td className="num">{o.items}</td>
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
              <Icon name="cal" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Rencana Produksi"}</h4>
            <p>
              {q || status
                ? "Tidak ada rencana yang sesuai dengan pencarian atau filter."
                : "Susun rencana bulan depan: pilih barang, jumlah dan tanggal mulai, dan baris Sales Order yang dicakup."}
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
                  <Link className="btn primary" href="/production/plan/new">
                    <Icon name="plus" size={15} /> Rencana Baru
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
