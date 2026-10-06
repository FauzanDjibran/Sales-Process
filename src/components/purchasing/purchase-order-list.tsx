"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { PurchaseOrderListRow } from "@/lib/erp/purchase-order";
import {
  PURCHASE_ORDER_KINDS,
  PURCHASE_ORDER_STATUS_BADGE,
  PURCHASE_ORDER_STATUS_TEXT,
  type PurchaseOrderAbilities,
  type PurchaseOrderKind,
  type PurchaseOrderStatus,
} from "@/lib/erp/purchase-order-workflow";

/**
 * The Purchase Order register of one kind, Barang or Jasa (P124). Drafts sort
 * first — somebody still has something to do about them — then newest first.
 */
export function PurchaseOrderList({
  kind,
  rows: all,
  can,
}: {
  kind: PurchaseOrderKind;
  rows: PurchaseOrderListRow[];
  can: PurchaseOrderAbilities;
}) {
  const router = useRouter();
  const k = PURCHASE_ORDER_KINDS[kind];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || r.orderNo.toLowerCase().includes(q) || r.supplierLabel.toLowerCase().includes(q) || r.supplierName.toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);
  const newButton = (
    <Link className="btn primary" href={`${k.path}/new`}>
      <Icon name="plus" size={15} /> {k.name} Baru
    </Link>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Pembelian</span>
          <span>/</span>
          <span className="cur">{k.name}</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            {k.name}
          </h1>
          <div className="ph-act">{can.create && newButton}</div>
        </div>
        <p className="ph-sub">
          Pesanan {kind === "goods" ? "barang" : "jasa"} ke satu supplier, dibuat dari Purchase Request yang Open, dengan
          harga dan pajaknya. Tidak memposting apa pun.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor PO atau supplier…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Submitted", "Open", "Closed", "Cancelled", "Rejected"] as PurchaseOrderStatus[]).map((s) => ({ value: s, label: PURCHASE_ORDER_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> purchase order
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 110 }}>Tgl Kirim</th>
                    <th>Supplier</th>
                    <th className="num" style={{ width: 70 }}>
                      Baris
                    </th>
                    <th className="num" style={{ width: 150 }}>
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`${k.path}/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`${k.path}/${r.id}`}>
                          {r.orderNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${PURCHASE_ORDER_STATUS_BADGE[r.status]}`}>{PURCHASE_ORDER_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.orderDate)}</td>
                      <td>{formatDate(r.deliveryDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.supplierLabel}</span>
                          <span className="nm">{r.supplierName}</span>
                        </span>
                      </td>
                      <td className="num">{r.lines}</td>
                      <td className="num">
                        <span className="mny">{formatMoney(r.total, "IDR")}</span>
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
              <Icon name={kind === "goods" ? "box" : "tags"} size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : `Belum ada ${k.name}`}</h4>
            <p>
              {q || status
                ? "Tidak ada Purchase Order yang sesuai dengan pencarian atau filter."
                : `Pesan ${kind === "goods" ? "barang" : "jasa"} dari Purchase Request yang Open ke satu supplier.`}
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
              can.create && <div className="cta">{newButton}</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
