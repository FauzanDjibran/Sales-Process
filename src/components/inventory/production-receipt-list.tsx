"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { DocumentHeader } from "@/components/ui/document-header";
import { formatDate, formatNumber } from "@/lib/format";
import type { ProductionReceiptRow } from "@/lib/erp/production-receipt";
import { PRODUCTION_RECEIPT_PATH, PRODUCTION_RECEIPT_STATUS_BADGE, PRODUCTION_RECEIPT_STATUS_TEXT, type ProductionReceiptStatus } from "@/lib/erp/production-receipt-shape";

const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const TABS: [ProductionReceiptStatus | "", string][] = [
  ["Submitted", "Diajukan"],
  ["Posted", "Diterima"],
  ["", "Semua"],
];

/**
 * The register of BSTB ke Finish Goods (P303): what the last Unit of a line sent
 * to the user's warehouses, waiting ones first. Made in the Produksi
 * application; the warehouse only receives, so there is no Baru here.
 */
export function ProductionReceiptList({ rows: all }: { rows: ProductionReceiptRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(all.some((r) => r.status === "Submitted") ? "Submitted" : "");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!status || r.status === status) && (!q || [r.no, r.unitLabel, r.warehouseLabel, r.warehouseName].some((v) => v.toLowerCase().includes(q)))), [all, status, q]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <DocumentHeader module="Persediaan" icon="down" title="BSTB ke Finish Goods" sub="Barang jadi yang dikirim Unit terakhir routing ke gudang Anda. Dibuat di aplikasi Produksi; gudang menekan Terima, barang masuk dengan No. Stok yang sama." />
      <div className="card">
        <div className="qtabs" role="tablist">
          {TABS.map(([value, label]) => (
            <button key={value || "all"} type="button" role="tab" aria-selected={status === value} className={status === value ? "act" : ""} onClick={() => setStatus(value)}>
              {label}
              <span className="n">{value ? all.filter((o) => o.status === value).length : all.length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, unit atau gudang…" />
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
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada BSTB ke Finish Goods"}</h4>
            <p>{q || status ? "Tidak ada dokumen yang sesuai dengan pencarian atau tab ini." : "Kiriman dibuat dari Workspace Unit di aplikasi Produksi, lewat Kirim ke Finish Goods di Stand By Unit terakhir routing."}</p>
          </div>
        )}
      </div>
    </>
  );
}
