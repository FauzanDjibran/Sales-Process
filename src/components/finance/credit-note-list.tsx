"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Amount } from "@/components/ui/amount";
import { DocumentHeader } from "@/components/ui/document-header";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import type { CreditNoteListRow } from "@/lib/erp/ar-credit-note";
import {
  CREDIT_NOTE_STATUS_BADGE,
  CREDIT_NOTE_STATUS_TEXT,
  type CreditNoteAbilities,
  type CreditNoteStatus,
} from "@/lib/erp/ar-credit-note-workflow";

const STATUSES: CreditNoteStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Credit Note Penjualan register (P292): Drafts first, then newest first. */
export function CreditNoteList({ rows: all, can }: { rows: CreditNoteListRow[]; can: CreditNoteAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all
        .filter(
          (o) =>
            (!status || o.status === status) &&
            (!q ||
              o.creditNo.toLowerCase().includes(q) ||
              o.invoiceNo.toLowerCase().includes(q) ||
              o.customerLabel.toLowerCase().includes(q) ||
              o.customerName.toLowerCase().includes(q))
        )
        .sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft")),
    [all, q, status]
  );
  const paging = usePaging(rows, `${q}|${status}`);

  const newButton = can.create && (
    <Link className="btn primary" href="/finance/invoice/credit-note/new">
      <Icon name="plus" size={15} /> Credit Note Baru
    </Link>
  );

  return (
    <>
      <DocumentHeader
        module="Finance"
        icon="file"
        title="Credit Note Penjualan"
        sub="Mengurangi penjualan, PPN Keluaran dan piutang atas barang yang kembali setelah Invoice diposting. Sisa yang tidak tertutup piutang menjadi kredit customer."
      >
        {newButton}
      </DocumentHeader>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, Invoice atau customer…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[{ value: "", label: "Status: semua" }, ...STATUSES.map((s) => ({ value: s, label: CREDIT_NOTE_STATUS_TEXT[s] }))]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> credit note
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>No</th>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th style={{ width: 160 }}>Invoice</th>
                    <th>Customer</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                    <th className="num" style={{ width: 170 }}>Total</th>
                    <th style={{ width: 52 }} />
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o, i) => (
                    <tr key={o.id} onClick={() => router.push(`/finance/invoice/credit-note/${o.id}`)}>
                      <td className="no">{(paging.page - 1) * paging.perPage + i + 1}</td>
                      <td>
                        <Link className="lab" href={`/finance/invoice/credit-note/${o.id}`}>
                          {o.creditNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${CREDIT_NOTE_STATUS_BADGE[o.status]}`}>{CREDIT_NOTE_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.creditDate)}</td>
                      <td>
                        <Link className="lab" href={`/finance/invoice/sales/${o.invoiceId}`} onClick={(e) => e.stopPropagation()}>
                          {o.invoiceNo}
                        </Link>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.customerLabel}</span>
                          <span className="nm">{o.customerName}</span>
                        </span>
                      </td>
                      <td className="num">{o.lines}</td>
                      <td className="num">
                        <Amount value={o.total} currency={o.currency} />
                      </td>
                      <td className="acts">
                        <span className="ract">
                          <Link className="iact" href={`/finance/invoice/credit-note/${o.id}`} title="Lihat detail" onClick={(e) => e.stopPropagation()}>
                            <Icon name="eye" size={15} />
                          </Link>
                        </span>
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
              <Icon name="file" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Credit Note"}</h4>
            <p>
              {q || status
                ? "Tidak ada Credit Note yang sesuai dengan pencarian atau filter."
                : "Credit Note dibuat dari Invoice Penjualan yang barangnya kembali lewat Receipt Note retur setelah ditagih."}
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
              newButton && <div className="cta">{newButton}</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
