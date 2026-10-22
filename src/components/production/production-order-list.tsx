"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatNumber } from "@/lib/format";
import type { ProductionOrderListRow } from "@/lib/erp/production-order";
import {
  PRODUCTION_ORDER_STATUS_BADGE,
  PRODUCTION_ORDER_STATUS_TEXT,
  type ProductionOrderAbilities,
  type ProductionOrderStatus,
} from "@/lib/erp/production-order-workflow";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/**
 * The Perintah Produksi register (Walet step 3). Drafts first — not yet given
 * to Logistik — then Open ones, then newest first.
 */
export function ProductionOrderList({ orders, can }: { orders: ProductionOrderListRow[]; can: ProductionOrderAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = orders.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q || o.orderNo.toLowerCase().includes(q) || o.targetLabel.toLowerCase().includes(q) || o.targetName.toLowerCase().includes(q))
    );
    const rank = (x: ProductionOrderListRow) => (x.status === "Draft" ? 2 : x.status === "Open" ? 1 : 0);
    return out.sort((a, b) => rank(b) - rank(a));
  }, [orders, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <span className="cur">Perintah Produksi</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            Perintah Produksi
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/production/order/new">
                <Icon name="plus" size={15} /> Perintah Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Perintah PPIC untuk satu Partai: Item Target dan jumlahnya, rute workstation, dan kebutuhan bahan dari BoM. Setelah dibuka, Logistik
          memilih lot dan mengirimnya ke workstation dengan BSTB.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor atau Item Target…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Open", "Closed", "Cancelled"] as ProductionOrderStatus[]).map((s) => ({ value: s, label: PRODUCTION_ORDER_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> perintah
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Nomor</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th>Item Target</th>
                    <th className="num" style={{ width: 140 }}>Qty Target</th>
                    <th style={{ width: 160 }}>Mulai di</th>
                    <th className="num" style={{ width: 80 }}>Langkah</th>
                    <th className="num" style={{ width: 100 }}>Kebutuhan</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/production/order/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/production/order/${o.id}`}>
                          {o.orderNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${PRODUCTION_ORDER_STATUS_BADGE[o.status]}`}>{PRODUCTION_ORDER_STATUS_TEXT[o.status]}</span>
                      </td>
                      <td>{formatDate(o.orderDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.targetLabel}</span>
                          <span className="nm">{o.targetName}</span>
                        </span>
                      </td>
                      <td className="num">
                        <span className="qview">
                          <span className="mny">{qtyText(o.targetQty)}</span>
                          <span className="lab">{o.targetUom}</span>
                        </span>
                      </td>
                      <td>{o.firstWorkstation ? <span className="lab">{o.firstWorkstation}</span> : <span className="dash">—</span>}</td>
                      <td className="num">{o.steps}</td>
                      <td className="num">{o.requirements || <span className="dash">—</span>}</td>
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
              <Icon name="clip" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Perintah Produksi"}</h4>
            <p>
              {q || status
                ? "Tidak ada Perintah yang sesuai dengan pencarian atau filter."
                : "Perintah Produksi memulai sebuah Partai: pilih Item Target, jumlahnya dan Routing; kebutuhan bahan dihitung dari BoM."}
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
                  <Link className="btn primary" href="/production/order/new">
                    <Icon name="plus" size={15} /> Perintah Baru
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
