"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { SalesOrderListRow } from "@/lib/erp/sales-order";
import {
  SALES_ORDER_STATUS_BADGE,
  SALES_ORDER_STATUS_TEXT,
  type SalesOrderAbilities,
  type SalesOrderStatus,
} from "@/lib/erp/sales-order-workflow";

/**
 * The Sales Order register. Drafts sort first — they are the rows somebody
 * still has something to do about — then newest first.
 */
export function SalesOrderList({ orders, can }: { orders: SalesOrderListRow[]; can: SalesOrderAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = orders.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q ||
          o.orderNo.toLowerCase().includes(q) ||
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
          <span className="cur">Sales Order</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            Sales Order
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/sales/order/new">
                <Icon name="plus" size={15} /> Sales Order Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Pesanan barang dari customer. Sales Order tidak memposting apa pun; setelah dikonfirmasi isinya
          terkunci dan menjadi dasar pengiriman dan penagihan.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor SO atau customer…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Confirmed", "Cancelled"] as SalesOrderStatus[]).map((s) => ({
                value: s,
                label: SALES_ORDER_STATUS_TEXT[s],
              })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> sales order
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
                    <th>Customer</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                    <th className="num" style={{ width: 170 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/sales/order/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/sales/order/${o.id}`}>
                          {o.orderNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${SALES_ORDER_STATUS_BADGE[o.status]}`}>
                          {SALES_ORDER_STATUS_TEXT[o.status]}
                        </span>
                      </td>
                      <td>{formatDate(o.orderDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.customerLabel}</span>
                          <span className="nm">{o.customerName}</span>
                        </span>
                      </td>
                      <td className="num">{o.lines}</td>
                      <td className="num">
                        <span className="mny">{formatMoney(o.total, "IDR")}</span>
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
              <Icon name="clip" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Sales Order"}</h4>
            <p>
              {q || status
                ? "Tidak ada Sales Order yang sesuai dengan pencarian atau filter."
                : "Sales Order dimulai dari customer: termin dan mode harganya mengikuti data customer."}
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
                  <Link className="btn primary" href="/sales/order/new">
                    <Icon name="plus" size={15} /> Sales Order Baru
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
