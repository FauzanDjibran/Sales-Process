"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { SearchField } from "@/components/ui/search-field";
import { DocumentHeader } from "@/components/ui/document-header";
import { formatDate, formatNumber } from "@/lib/format";
import type { ProductionReceiptRow } from "@/lib/erp/production-receipt";
import { PRODUCTION_RECEIPT_PURPOSES, PRODUCTION_RECEIPT_STATUS_BADGE, PRODUCTION_RECEIPT_STATUS_TEXT, type ProductionReceiptPurpose, type ProductionReceiptStatus } from "@/lib/erp/production-receipt-shape";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const STATUSES: ProductionReceiptStatus[] = ["Submitted", "Posted"];

const SUB: Record<ProductionReceiptPurpose, [string, string]> = {
  finish_goods: [
    "Barang jadi yang dikirim Unit terakhir routing ke gudang Anda. Dibuat di aplikasi Produksi; gudang menekan Terima, barang masuk dengan No. Stok yang sama.",
    "Kiriman dibuat dari Workspace Unit di aplikasi Produksi, lewat Kirim ke Finish Goods di Stand By Unit terakhir routing.",
  ],
  return: [
    "Barang yang dikeluarkan Unit mana pun dari Persiapan atau Stand By ke gudang Anda. Gudang menekan Terima dan memilih nilainya: terbawa atau tanpa nilai.",
    "BSTB Pengeluaran dibuat dari Workspace Unit di aplikasi Produksi, lewat tombol BSTB Pengeluaran di tab Persiapan atau Stand By.",
  ],
};

/**
 * The register of one purpose of the BSTB from production (P303, P304): what
 * was sent to the user's warehouses, waiting ones first. Made in the Produksi
 * application; the warehouse only receives, so there is no Baru here.
 */
export function ProductionReceiptList({ purpose, rows: all }: { purpose: ProductionReceiptPurpose; rows: ProductionReceiptRow[] }) {
  const p = PRODUCTION_RECEIPT_PURPOSES[purpose];
  const PRODUCTION_RECEIPT_PATH = p.path;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!status || r.status === status) && (!q || [r.no, r.unitLabel, r.warehouseLabel, r.warehouseName].some((v) => v.toLowerCase().includes(q)))), [all, status, q]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <DocumentHeader module="Persediaan" icon="down" title={p.name} sub={SUB[purpose][0]} />
      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, unit atau gudang…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[{ value: "", label: "Status: semua" }, ...STATUSES.map((v) => ({ value: v, label: PRODUCTION_RECEIPT_STATUS_TEXT[v] }))]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> dokumen
          </span>
        </div>
        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>No</th>
                    <th style={{ width: 210 }}>Nomor</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 106 }}>Tanggal</th>
                    <th>Unit Asal</th>
                    <th>Gudang Tujuan</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                    <th className="num" style={{ width: 100 }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r, i) => (
                    <tr key={r.id} onClick={() => router.push(`${PRODUCTION_RECEIPT_PATH}/${r.id}`)}>
                      <td className="mut">{(paging.page - 1) * paging.perPage + i + 1}</td>
                      <td>
                        <Link className="lab" href={`${PRODUCTION_RECEIPT_PATH}/${r.id}`}>
                          {r.no}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${PRODUCTION_RECEIPT_STATUS_BADGE[r.status]}`}>{PRODUCTION_RECEIPT_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.unitLabel}</span>
                          <span className="nm">{r.unitName}</span>
                        </span>
                      </td>
                      <td>
                        <span className="idc">
                          <span className="lab">{r.warehouseLabel}</span>
                          <span className="nm">{r.warehouseName}</span>
                        </span>
                      </td>
                      <td className="num">{r.lines}</td>
                      <td className="num">
                        <span className="mny">{qtyText(r.qty)}</span>
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
              <Icon name="down" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : `Belum ada ${p.name}`}</h4>
            <p>{q || status ? "Tidak ada dokumen yang sesuai dengan pencarian atau filter ini." : SUB[purpose][1]}</p>
          </div>
        )}
      </div>
    </>
  );
}
