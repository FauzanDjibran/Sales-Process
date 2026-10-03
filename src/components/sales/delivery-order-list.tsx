"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import type { DeliveryOrderListRow } from "@/lib/erp/delivery-order";
import {
  DELIVERY_ORDER_STATUS_BADGE,
  DELIVERY_ORDER_STATUS_TEXT,
  type DeliveryOrderAbilities,
  type DeliveryOrderStatus,
} from "@/lib/erp/delivery-order-workflow";

/**
 * The Delivery Order register (P93). Drafts sort first — they are the rows
 * somebody still has something to do about — then newest first. The ship date
 * and the warehouse are what the warehouse reads, so they sit beside the number.
 */
export function DeliveryOrderList({ orders, can }: { orders: DeliveryOrderListRow[]; can: DeliveryOrderAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = orders.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q ||
          o.doNo.toLowerCase().includes(q) ||
          o.customerOrderNo.toLowerCase().includes(q) ||
          o.customerLabel.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.warehouseLabel.toLowerCase().includes(q))
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
          <span className="cur">Delivery Order</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            Delivery Order
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/sales/delivery-order/new">
                <Icon name="plus" size={15} /> Delivery Order Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Perintah kirim ke satu gudang: barang dari Sales Order Open satu Customer Order, ke satu alamat pada satu
          tanggal. Hanya jumlah dan tidak memposting apa pun — barang keluar dicatat oleh Delivery Note.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor DO, CO, customer atau gudang…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Issued", "Closed", "Cancelled"] as DeliveryOrderStatus[]).map((s) => ({
                value: s,
                label: DELIVERY_ORDER_STATUS_TEXT[s],
              })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> delivery order
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
                    <th style={{ width: 106 }}>Tanggal Kirim</th>
                    <th style={{ width: 120 }}>Gudang</th>
                    <th style={{ width: 160 }}>Customer Order</th>
                    <th>Customer</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/sales/delivery-order/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/sales/delivery-order/${o.id}`}>
                          {o.doNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${DELIVERY_ORDER_STATUS_BADGE[o.status]}`}>
                          {DELIVERY_ORDER_STATUS_TEXT[o.status]}
                        </span>
                      </td>
                      <td>{formatDate(o.deliveryDate)}</td>
                      <td>
                        <span className="lab">{o.warehouseLabel}</span>
                      </td>
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
                      <td className="num">{o.lines}</td>
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
              <Icon name="truck" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Delivery Order"}</h4>
            <p>
              {q || status
                ? "Tidak ada Delivery Order yang sesuai dengan pencarian atau filter."
                : "Delivery Order dibuat dari Customer Order yang punya Sales Order berstatus Open: pilih barang Sales Order, gudang dan alamat kirim."}
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
                  <Link className="btn primary" href="/sales/delivery-order/new">
                    <Icon name="plus" size={15} /> Delivery Order Baru
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
