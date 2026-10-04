"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { InvoiceListRow } from "@/lib/erp/sales-invoice";
import {
  INVOICE_PAY_BADGE,
  INVOICE_PAY_TEXT,
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_TEXT,
  type InvoiceAbilities,
  type InvoiceStatus,
} from "@/lib/erp/sales-invoice-workflow";

/**
 * The Invoice Penjualan register (§9). Drafts sort first — goods not yet
 * billed — then newest first. The total is the net Piutang, after the Uang
 * Muka each Invoice used.
 */
export function InvoiceList({ rows: orders, can }: { rows: InvoiceListRow[]; can: InvoiceAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = orders.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q ||
          o.invoiceNo.toLowerCase().includes(q) ||
          o.customerOrderNo.toLowerCase().includes(q) ||
          o.customerLabel.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [orders, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Penjualan</span>
          <span>/</span>
          <span className="cur">Invoice Penjualan</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            Invoice Penjualan
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/sales/invoice/new">
                <Icon name="plus" size={15} /> Invoice Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Tagihan atas barang yang sudah dikirim: baris Delivery Note yang diposting dari satu Customer Order, dipotong
          uang muka yang dipilih. Posting mengakui piutang, penjualan dan PPN Keluaran.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor invoice, CO atau customer…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as InvoiceStatus[]).map((s) => ({
                value: s,
                label: INVOICE_STATUS_TEXT[s],
              })),
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
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th style={{ width: 106 }}>Jatuh Tempo</th>
                    <th style={{ width: 160 }}>Customer Order</th>
                    <th>Customer</th>
                    <th className="num" style={{ width: 150 }}>Total Tagihan</th>
                    <th style={{ width: 150 }}>Pembayaran</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/sales/invoice/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/sales/invoice/${o.id}`}>
                          {o.invoiceNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${INVOICE_STATUS_BADGE[o.status]}`}>{INVOICE_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.invoiceDate)}</td>
                      <td>{formatDate(o.dueDate)}</td>
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
                      <td className="num">
                        <span className="mny">{formatMoney(o.total, "IDR")}</span>
                      </td>
                      <td>
                        {o.pay ? (
                          <span className="dstack">
                            <span>
                              <span className={`bdg ${INVOICE_PAY_BADGE[o.pay.state]}`}>{INVOICE_PAY_TEXT[o.pay.state]}</span>
                              {o.pay.overdue && <span className="bdg t-bad" style={{ marginLeft: 4 }}>Lewat tempo</span>}
                            </span>
                            {o.pay.state === "Partial" && <span className="d2">sisa {formatMoney(o.pay.open, "IDR")}</span>}
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
              <Icon name="file" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Invoice Penjualan"}</h4>
            <p>
              {q || status
                ? "Tidak ada Invoice yang sesuai dengan pencarian atau filter."
                : "Invoice dibuat dari Customer Order yang barangnya sudah dikirim: pilih baris Delivery Note yang ditagih dan uang muka yang dipakai."}
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
                  <Link className="btn primary" href="/sales/invoice/new">
                    <Icon name="plus" size={15} /> Invoice Baru
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
