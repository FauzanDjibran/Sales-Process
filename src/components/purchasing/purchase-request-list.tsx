"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import type { PurchaseRequestListRow } from "@/lib/erp/purchase-request";
import {
  PURCHASE_REQUEST_KINDS,
  PURCHASE_REQUEST_STATUS_BADGE,
  PURCHASE_REQUEST_STATUS_TEXT,
  type PurchaseRequestAbilities,
  type PurchaseRequestKind,
  type PurchaseRequestStatus,
} from "@/lib/erp/purchase-request-workflow";

/**
 * The Purchase Request register of one kind, Barang or Jasa (P123). Drafts sort
 * first — somebody still has something to do about them — then newest first.
 */
export function PurchaseRequestList({
  kind,
  rows: all,
  can,
}: {
  kind: PurchaseRequestKind;
  rows: PurchaseRequestListRow[];
  can: PurchaseRequestAbilities;
}) {
  const router = useRouter();
  const k = PURCHASE_REQUEST_KINDS[kind];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || r.requestNo.toLowerCase().includes(q) || (r.requester ?? "").toLowerCase().includes(q))
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
              <Icon name={kind === "goods" ? "box" : "tags"} size={16} />
            </span>
            {k.name}
          </h1>
          <div className="ph-act">{can.create && newButton}</div>
        </div>
        <p className="ph-sub">
          Permintaan {kind === "goods" ? "barang" : "jasa"} dalam satuan dasarnya dan tanggal dibutuhkan. Tanpa supplier,
          harga dan pajak — itu milik Purchase Order — dan tidak memposting apa pun.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor PR atau peminta…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Open", "Closed", "Cancelled"] as PurchaseRequestStatus[]).map((s) => ({ value: s, label: PURCHASE_REQUEST_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> purchase request
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
                    <th style={{ width: 120 }}>Dibutuhkan</th>
                    <th>Peminta</th>
                    {kind === "goods" && <th style={{ width: 120 }}>Gudang</th>}
                    <th className="num" style={{ width: 70 }}>
                      Baris
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`${k.path}/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`${k.path}/${r.id}`}>
                          {r.requestNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${PURCHASE_REQUEST_STATUS_BADGE[r.status]}`}>{PURCHASE_REQUEST_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.requestDate)}</td>
                      <td>{formatDate(r.neededDate)}</td>
                      <td>{r.requester ?? <span className="dash">—</span>}</td>
                      {kind === "goods" && <td>{r.warehouseLabel ? <span className="lab">{r.warehouseLabel}</span> : <span className="dash">—</span>}</td>}
                      <td className="num">{r.lines}</td>
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
                ? "Tidak ada Purchase Request yang sesuai dengan pencarian atau filter."
                : `Catat ${kind === "goods" ? "barang" : "jasa"} yang dibutuhkan, jumlahnya dan kapan dibutuhkan; Purchase Order dibuat darinya setelah diajukan.`}
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
