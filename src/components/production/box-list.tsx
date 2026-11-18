"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import type { BoxRow } from "@/lib/erp/production-box";
import { formatDate, formatNumber } from "@/lib/format";

/** The register of Kotak: newest first. Posted at Tutup Kotak, so no status tabs. No prices (P275). */
export function BoxList({ rows: all }: { rows: BoxRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!q || [r.no, r.trackingNo, r.itemLabel, r.unitLabel, r.partaiNo ?? ""].some((s) => s.toLowerCase().includes(q)))), [all, q]);
  const paging = usePaging(rows, q);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <span className="cur">Kotak</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="box" size={16} />
            </span>
            Kotak
          </h1>
        </div>
        <p className="ph-sub">Kotak Packing 95: keping dan CAIQ-nya menjadi satu No. Stok kotak menurut BoM Packing Nama Jual.</p>
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, No. Stok kotak, Nama Jual, atau partai…" />
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
                    <th style={{ width: 250 }}>Nomor</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 200 }}>No. Stok Kotak</th>
                    <th>Nama Jual</th>
                    <th className="num" style={{ width: 90 }}>Keping</th>
                    <th className="num" style={{ width: 96 }}>Gram</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/production/box/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/production/box/${r.id}`} onClick={(e) => e.stopPropagation()}>
                          {r.no}
                        </Link>
                      </td>
                      <td>{formatDate(r.date)}</td>
                      <td className="mono">{r.trackingNo}</td>
                      <td>
                        <span className="lab">{r.itemLabel}</span> {r.itemName}
                      </td>
                      <td className="num">{r.pieces}</td>
                      <td className="num">{r.grams ? formatNumber(r.grams, r.grams % 1 ? 2 : 0) : <span className="dash">—</span>}</td>
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
              <Icon name="box" size={18} />
            </div>
            <h4>Belum ada dokumen</h4>
            <p>Buka Persiapan Packing 95 di Workspace dan buat kotak dari kepingnya.</p>
          </div>
        )}
      </div>
    </>
  );
}
