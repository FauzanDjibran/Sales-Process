"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { PermitInvoiceListRow } from "@/lib/erp/permit-invoice";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_TEXT, type InvoiceAbilities, type InvoiceStatus } from "@/lib/erp/ar-invoice-workflow";

/** The Invoice Perizinan register (P137). Drafts first, then newest first. */
export function PermitInvoiceList({ rows: all, can }: { rows: PermitInvoiceListRow[]; can: InvoiceAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all
        .filter(
          (r) =>
            (!status || r.status === status) &&
            (!q || [r.invoiceNo, r.requestNo, r.customerLabel, r.customerName, r.description].some((x) => x.toLowerCase().includes(q)))
        )
        .sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft")),
    [all, q, status]
  );
  const paging = usePaging(rows, `${q}|${status}`);
  const pay = (r: PermitInvoiceListRow) =>
    r.status !== "Posted" ? null : r.paid >= r.total ? ["Lunas", "t-ok"] : r.paid > 0 ? ["Sebagian", "t-info"] : ["Belum Dibayar", "t-warn"];

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span>Invoice</span>
          <span>/</span>
          <span className="cur">Invoice Perizinan</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            Invoice Perizinan
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/finance/invoice/permit/new">
                <Icon name="plus" size={15} /> Invoice Perizinan Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Tagihan atas realisasi Pengajuan Perizinan, satu baris uraian. Posting mengakui piutang, Pendapatan Perizinan dan
          PPN Keluaran, memakai Uang Muka Perizinan, dan membuat faktur pajaknya.
        </p>
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, Pengajuan atau customer…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as InvoiceStatus[]).map((s) => ({ value: s, label: INVOICE_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> invoice
          </span>
        </div>
        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 150 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th>Customer / Pengajuan</th>
                    <th className="num" style={{ width: 160 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => {
                    const p = pay(r);
                    return (
                      <tr key={r.id} onClick={() => router.push(`/finance/invoice/permit/${r.id}`)}>
                        <td>
                          <Link className="lab" href={`/finance/invoice/permit/${r.id}`}>
                            {r.invoiceNo}
                          </Link>
                        </td>
                        <td>
                          <span className={`bdg ${INVOICE_STATUS_BADGE[r.status]}`}>{INVOICE_STATUS_TEXT[r.status]}</span>{" "}
                          {p && <span className={`bdg ${p[1]}`}>{p[0]}</span>}
                        </td>
                        <td>{formatDate(r.invoiceDate)}</td>
                        <td>
                          <span className="idc">
                            <span className="lab">{r.customerLabel}</span>
                            <span className="nm">
                              {r.customerName} · {r.requestNo}
                            </span>
                          </span>
                        </td>
                        <td className="num">
                          <span className="mny">{formatMoney(r.total, "IDR")}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={paging.page} pages={paging.pages} total={paging.total} perPage={paging.perPage} onPage={paging.setPage} onPerPage={paging.setPerPage} />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="file" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Invoice Perizinan"}</h4>
            <p>{q || status ? "Tidak ada invoice yang sesuai dengan pencarian atau filter." : "Buat invoice dari realisasi perizinan yang belum ditagih."}</p>
          </div>
        )}
      </div>
    </>
  );
}
