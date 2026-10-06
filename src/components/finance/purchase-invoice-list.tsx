"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { PurchaseInvoiceListRow } from "@/lib/erp/ap-invoice";
import {
  INVOICE_PAY_BADGE,
  INVOICE_PAY_TEXT,
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_TEXT,
  type InvoiceAbilities,
  type InvoiceStatus,
} from "@/lib/erp/ap-invoice-workflow";

/** The Invoice Pembelian register (P128). Drafts first, then newest first; a posted one shows where it stands. */
export function PurchaseInvoiceList({ rows: all, can }: { rows: PurchaseInvoiceListRow[]; can: InvoiceAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || [r.invoiceNo, r.supplierInvoiceNo, r.orderNo, r.supplierLabel, r.supplierName].some((x) => x.toLowerCase().includes(q)))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);
  const newButton = (
    <Link className="btn primary" href="/finance/invoice/purchase/new">
      <Icon name="plus" size={15} /> Invoice Pembelian Baru
    </Link>
  );
  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span className="cur">Invoice Pembelian</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            Invoice Pembelian
          </h1>
          <div className="ph-act">{can.create && newButton}</div>
        </div>
        <p className="ph-sub">
          Tagihan supplier atas barang dan jasa yang sudah diterima, selalu pada harga Purchase Order. Posting mengakui hutang,
          PPN Masukan dan PPh yang kita potong.
        </p>
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, invoice supplier, PO atau supplier…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[{ value: "", label: "Status: semua" }, ...(["Draft", "Posted", "Cancelled"] as InvoiceStatus[]).map((s) => ({ value: s, label: INVOICE_STATUS_TEXT[s] }))]}
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
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 100 }}>Jatuh Tempo</th>
                    <th>Supplier · Invoice Supplier</th>
                    <th style={{ width: 150 }}>Purchase Order</th>
                    <th className="num" style={{ width: 150 }}>
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/finance/invoice/purchase/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/finance/invoice/purchase/${r.id}`}>
                          {r.invoiceNo}
                        </Link>
                      </td>
                      <td>
                        {r.pay ? (
                          <span className={`bdg ${INVOICE_PAY_BADGE[r.pay.state]}`}>{INVOICE_PAY_TEXT[r.pay.state]}</span>
                        ) : (
                          <span className={`bdg ${INVOICE_STATUS_BADGE[r.status]}`}>{INVOICE_STATUS_TEXT[r.status]}</span>
                        )}
                        {r.pay?.overdue && <span className="bdg t-bad">Lewat jatuh tempo</span>}
                      </td>
                      <td>{formatDate(r.invoiceDate)}</td>
                      <td>{formatDate(r.dueDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.supplierLabel}</span>
                          <span className="nm">
                            {r.supplierName} · <span className="mono">{r.supplierInvoiceNo}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="mono">{r.orderNo}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{formatMoney(r.total, "IDR")}</span>
                      </td>
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
              <Icon name="file" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Invoice Pembelian"}</h4>
            <p>{q || status ? "Tidak ada invoice yang sesuai dengan pencarian atau filter." : "Catat tagihan supplier dari baris Receipt Note yang sudah diposting."}</p>
            {!(q || status) && can.create && <div className="cta">{newButton}</div>}
          </div>
        )}
      </div>
    </>
  );
}
