"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { DocumentHeader } from "@/components/ui/document-header";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import type { SalesReturnListRow } from "@/lib/erp/sales-return";
import {
  SALES_RETURN_STATUS_BADGE,
  SALES_RETURN_STATUS_TEXT,
  salesReturnReasonLabel,
  type SalesReturnAbilities,
  type SalesReturnStatus,
} from "@/lib/erp/sales-return-workflow";

const STATUSES: SalesReturnStatus[] = ["Draft", "Submitted", "Open", "Closed", "Rejected", "Cancelled"];

/**
 * The Sales Return register (P287). Drafts and returns waiting for approval
 * sort first — the ones someone has to act on — then newest first.
 */
export function SalesReturnList({ rows: all, can }: { rows: SalesReturnListRow[]; can: SalesReturnAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const waiting = (s: SalesReturnStatus) => Number(s === "Draft" || s === "Submitted");
    return all
      .filter(
        (o) =>
          (!status || o.status === status) &&
          (!q ||
            o.returnNo.toLowerCase().includes(q) ||
            o.customerOrderNo.toLowerCase().includes(q) ||
            o.customerLabel.toLowerCase().includes(q) ||
            o.customerName.toLowerCase().includes(q))
      )
      .sort((a, b) => waiting(b.status) - waiting(a.status));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  const newButton = can.create && (
    <Link className="btn primary" href="/sales/return/new">
      <Icon name="plus" size={15} /> Sales Return Baru
    </Link>
  );

  return (
    <>
      <DocumentHeader
        module="Penjualan"
        icon="box"
        title="Sales Return"
        sub="Barang yang dikembalikan customer, dari Delivery Note yang sudah diposting pada satu Customer Order. Tidak memposting apa pun; gudang menerimanya dengan Receipt Note."
      >
        {newButton}
      </DocumentHeader>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor retur, CO atau customer…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...STATUSES.map((s) => ({ value: s, label: SALES_RETURN_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> sales return
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
                    <th style={{ width: 160 }}>Customer Order</th>
                    <th>Customer</th>
                    <th style={{ width: 170 }}>Alasan</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                    <th style={{ width: 52 }} />
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o, i) => (
                    <tr key={o.id} onClick={() => router.push(`/sales/return/${o.id}`)}>
                      <td className="no">{(paging.page - 1) * paging.perPage + i + 1}</td>
                      <td>
                        <Link className="lab" href={`/sales/return/${o.id}`}>
                          {o.returnNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${SALES_RETURN_STATUS_BADGE[o.status]}`}>{SALES_RETURN_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.returnDate)}</td>
                      <td>
                        <Link className="lab" href={`/sales/customer-order/${o.customerOrderId}`} onClick={(e) => e.stopPropagation()}>
                          {o.customerOrderNo}
                        </Link>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.customerLabel}</span>
                          <span className="nm">{o.customerName}</span>
                        </span>
                      </td>
                      <td>{salesReturnReasonLabel(o.reason)}</td>
                      <td className="num">{o.lines}</td>
                      <td className="acts">
                        <span className="ract">
                          <Link className="iact" href={`/sales/return/${o.id}`} title="Lihat detail" onClick={(e) => e.stopPropagation()}>
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
              <Icon name="box" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Sales Return"}</h4>
            <p>
              {q || status
                ? "Tidak ada Sales Return yang sesuai dengan pencarian atau filter."
                : "Sales Return dibuat dari Delivery Note yang sudah diposting: pilih Customer Order, lalu barang dan jumlah yang dikembalikan."}
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
