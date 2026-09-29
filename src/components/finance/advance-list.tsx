"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import type { SalesAdvanceListRow } from "@/lib/erp/sales-advance";
import {
  ADVANCE_STATUS_BADGE,
  ADVANCE_STATUS_TEXT,
  type AdvanceAbilities,
  type AdvanceStatus,
} from "@/lib/erp/sales-advance-workflow";

/**
 * The Uang Muka Penjualan register. Drafts sort first, then newest first. An
 * issued bill past its due date is marked; until Pembayaran exists every issued
 * bill is unpaid, so the mark is not yet narrowed by payment.
 */
const isOverdue = (r: SalesAdvanceListRow, today: string) => r.status === "Issued" && r.dueDate < today;

export function AdvanceList({ rows: all, can }: { rows: SalesAdvanceListRow[]; can: AdvanceAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const today = todayIso();

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || (status === "overdue" ? isOverdue(r, today) : r.status === status)) &&
        (!q ||
          r.advanceNo.toLowerCase().includes(q) ||
          r.orderNo.toLowerCase().includes(q) ||
          r.customerLabel.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status, today]);
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
          <span className="cur">Uang Muka Penjualan</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="wallet" size={16} />
            </span>
            Uang Muka Penjualan
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/finance/advance/sales/new">
                <Icon name="plus" size={15} /> Uang Muka Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Tagihan uang muka ke customer atas Sales Order yang sudah dikonfirmasi. Menerbitkan tagihan tidak
          memposting apa pun; kas, Uang Muka Penjualan dan PPN Keluaran dicatat saat pembayarannya diterima.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, Sales Order atau customer…" />
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
                    <th>Customer / Sales Order</th>
                    <th className="num" style={{ width: 140 }}>DPP</th>
                    <th className="num" style={{ width: 120 }}>PPN</th>
                    <th className="num" style={{ width: 150 }}>Total Tagihan</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/finance/advance/sales/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/finance/advance/sales/${r.id}`}>
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
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Uang Muka Penjualan"}</h4>
            <p>
              {q || status
                ? "Tidak ada tagihan yang sesuai dengan pencarian atau filter."
                : "Buat tagihan uang muka dari Sales Order yang sudah dikonfirmasi."}
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
                  <Link className="btn primary" href="/finance/advance/sales/new">
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
