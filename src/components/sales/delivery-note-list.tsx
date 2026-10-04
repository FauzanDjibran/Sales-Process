"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { DeliveryNoteListRow } from "@/lib/erp/delivery-note";
import {
  DELIVERY_NOTE_STATUS_BADGE,
  DELIVERY_NOTE_STATUS_TEXT,
  type DeliveryNoteAbilities,
  type DeliveryNoteStatus,
} from "@/lib/erp/delivery-note-workflow";

/**
 * The Delivery Note register (C28). Drafts sort first — goods not yet booked
 * out — then newest first. The cost column is the HPP each posted note
 * recognised; a Draft has none yet.
 */
export function DeliveryNoteList({ orders, can }: { orders: DeliveryNoteListRow[]; can: DeliveryNoteAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = orders.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q ||
          o.dnNo.toLowerCase().includes(q) ||
          o.deliveryOrderNo.toLowerCase().includes(q) ||
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
          <span className="cur">Delivery Note</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            Delivery Note
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/sales/delivery-note/new">
                <Icon name="plus" size={15} /> Delivery Note Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Surat jalan: barang yang benar-benar keluar dari gudang, dibuat dari Delivery Order yang sudah diterbitkan.
          Posting mengakui HPP dan mengurangi Persediaan; piutang baru diakui di Invoice Penjualan.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor SJ, DO, CO, customer atau gudang…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as DeliveryNoteStatus[]).map((s) => ({
                value: s,
                label: DELIVERY_NOTE_STATUS_TEXT[s],
              })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> delivery note
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
                    <th style={{ width: 160 }}>Delivery Order</th>
                    <th>Customer</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                    <th className="num" style={{ width: 140 }}>HPP</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/sales/delivery-note/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/sales/delivery-note/${o.id}`}>
                          {o.dnNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${DELIVERY_NOTE_STATUS_BADGE[o.status]}`}>
                          {DELIVERY_NOTE_STATUS_TEXT[o.status]}
                        </span>
                      </td>
                      <td>{formatDate(o.dnDate)}</td>
                      <td>
                        <span className="lab">{o.warehouseLabel}</span>
                      </td>
                      <td>
                        <Link className="lab" href={`/sales/delivery-order/${o.deliveryOrderId}`} onClick={(e) => e.stopPropagation()}>
                          {o.deliveryOrderNo}
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
                        {o.status === "Posted" ? <span className="mny">{formatMoney(o.cost, "IDR")}</span> : <span className="dash">—</span>}
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
              <Icon name="truck" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Delivery Note"}</h4>
            <p>
              {q || status
                ? "Tidak ada Delivery Note yang sesuai dengan pencarian atau filter."
                : "Delivery Note dibuat dari Delivery Order yang sudah diterbitkan: pilih barang dan jumlah yang keluar dari gudang."}
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
                  <Link className="btn primary" href="/sales/delivery-note/new">
                    <Icon name="plus" size={15} /> Delivery Note Baru
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
