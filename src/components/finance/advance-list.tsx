"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import type { SalesAdvanceListRow } from "@/lib/erp/ar-advance";
import type { AdvanceVariant } from "@/lib/erp/ar-advance-workflow";

const LIST_TEXT = {
  sales: {
    title: "Uang Muka Penjualan",
    base: "/finance/advance/sales",
    source: "Customer Order",
    sub: "Tagihan uang muka ke customer atas Customer Order berstatus Open. Menerbitkan tagihan tidak memposting apa pun; kas, Uang Muka Penjualan dan PPN Keluaran dicatat saat pembayarannya diterima.",
    empty: "Buat tagihan uang muka dari Customer Order berstatus Open.",
  },
  permit: {
    title: "Uang Muka Perizinan",
    base: "/finance/advance/permit",
    source: "Pengajuan",
    sub: "Tagihan uang muka ke customer atas Pengajuan Perizinan yang disetujui, satu baris uraian. Menerbitkan tagihan tidak memposting apa pun; kas, Uang Muka Perizinan dan PPN Keluaran dicatat saat pembayarannya diterima.",
    empty: "Buat tagihan uang muka dari Pengajuan Perizinan yang sudah disetujui.",
  },
} as const;
import {
  ADVANCE_STATUS_BADGE,
  ADVANCE_STATUS_TEXT,
  type AdvanceAbilities,
  type AdvanceStatus,
} from "@/lib/erp/ar-advance-workflow";

/**
 * The Uang Muka Penjualan register. Drafts sort first, then newest first. An
 * issued bill carries its payment state — Belum Dibayar, Sebagian or Lunas —
 * from the posted receipts that settled it (P66), and one not fully paid past
 * its due date is marked.
 */
export type PayState = "Belum Dibayar" | "Sebagian" | "Lunas";
export function payStateOf(total: number, paid: number): PayState {
  return paid >= total ? "Lunas" : paid > 0 ? "Sebagian" : "Belum Dibayar";
}
const PAY_TAG: Record<PayState, string> = { "Belum Dibayar": "t-warn", Sebagian: "t-info", Lunas: "t-ok" };

export function AdvanceList({
  rows: all,
  paid,
  can,
  variant = "sales",
}: {
  rows: SalesAdvanceListRow[];
  /** Settled by posted receipts, per bill id. */
  paid: Record<number, number>;
  can: AdvanceAbilities;
  variant?: AdvanceVariant;
}) {
  const T = LIST_TEXT[variant];
  const stateOf = (r: SalesAdvanceListRow) => payStateOf(r.total, paid[r.id] ?? 0);
  const isOverdue = (r: SalesAdvanceListRow, today: string) =>
    r.status === "Issued" && r.dueDate < today && stateOf(r) !== "Lunas";
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const today = todayIso();

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status ||
          (status === "overdue"
            ? isOverdue(r, today)
            : status.startsWith("pay:")
              ? r.status === "Issued" && stateOf(r) === status.slice(4)
              : r.status === status)) &&
        (!q ||
          r.advanceNo.toLowerCase().includes(q) ||
          r.orderNo.toLowerCase().includes(q) ||
          r.customerLabel.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, status, today, paid]);
  const paging = usePaging(rows, `${q}|${status}`);
  const money = (n: number) => formatMoney(n, "IDR");

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span>Uang Muka</span>
          <span>/</span>
          <span className="cur">{T.title}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="wallet" size={16} />
            </span>
            {T.title}
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href={`${T.base}/new`}>
                <Icon name="plus" size={15} /> Uang Muka Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          {T.sub}
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder={`Cari nomor, ${T.source} atau customer…`} />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Issued", "Cancelled"] as AdvanceStatus[]).map((s) => ({
                value: s,
                label: ADVANCE_STATUS_TEXT[s],
              })),
              { value: "pay:Belum Dibayar", label: "Belum Dibayar" },
              { value: "pay:Sebagian", label: "Dibayar Sebagian" },
              { value: "pay:Lunas", label: "Lunas" },
              { value: "overdue", label: "Lewat jatuh tempo" },
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> tagihan
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 116 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 106 }}>Jatuh Tempo</th>
                    <th>Customer / {T.source}</th>
                    <th className="num" style={{ width: 140 }}>DPP</th>
                    <th className="num" style={{ width: 120 }}>PPN</th>
                    <th className="num" style={{ width: 150 }}>Total Tagihan</th>
                    <th style={{ width: 120 }}>Pembayaran</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`${T.base}/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`${T.base}/${r.id}`}>
                          {r.advanceNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${ADVANCE_STATUS_BADGE[r.status]}`}>{ADVANCE_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.advanceDate)}</td>
                      <td>
                        {isOverdue(r, today) ? (
                          <span className="mny over" title="Lewat jatuh tempo">
                            {formatDate(r.dueDate)}
                          </span>
                        ) : (
                          formatDate(r.dueDate)
                        )}
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.customerLabel}</span>
                          <span className="nm">
                            {r.customerName} · {r.orderNo}
                          </span>
                        </span>
                      </td>
                      <td className="num">
                        <span className="mny">{money(r.dpp)}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{r.isTaxable ? money(r.ppn) : "—"}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{money(r.total)}</span>
                      </td>
                      <td>
                        {r.status === "Issued" ? (
                          <span className={`bdg ${PAY_TAG[stateOf(r)]}`} title={paid[r.id] ? `dibayar ${money(paid[r.id])}` : undefined}>
                            {stateOf(r)}
                          </span>
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={paging.page}
              pages={paging.pages}
              total={paging.total}
              perPage={paging.perPage}
              onPage={paging.setPage}
              onPerPage={paging.setPerPage}
            />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="wallet" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : `Belum ada ${T.title}`}</h4>
            <p>
              {q || status
                ? "Tidak ada tagihan yang sesuai dengan pencarian atau filter."
                : T.empty}
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
                  <Link className="btn primary" href={`${T.base}/new`}>
                    <Icon name="plus" size={15} /> Uang Muka Baru
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
