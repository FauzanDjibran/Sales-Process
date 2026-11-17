"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { TRANSFER_KIND_TEXT, TRANSFER_STATUS_TEXT, type TransferStatus } from "@/lib/erp/production-transfer-shape";
import type { TransferRow } from "@/lib/erp/production-transfer";
import { formatDate, formatNumber } from "@/lib/format";

/** The register of Push and BSTB: status tabs with their counts, newest first. No prices (P275). */
const TABS: [TransferStatus | "", string][] = [
  ["Submitted", TRANSFER_STATUS_TEXT.Submitted],
  ["Posted", "Diterima / Diposting"],
  ["", "Semua"],
];

export function TransferList({ rows: all, canCreate }: { rows: TransferRow[]; canCreate: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // A queue opens on what still waits for Terima, when there is any.
  const [status, setStatus] = useState<string>(() => (all.some((r) => r.status === "Submitted") ? "Submitted" : ""));
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => (!status || r.status === status) && (!q || [r.no, r.fromLabel, r.toLabel, TRANSFER_KIND_TEXT[r.kind]].some((s) => s.toLowerCase().includes(q)))), [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Dokumen</span>
          <span>/</span>
          <span className="cur">Push dan BSTB</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="truck" size={16} />
            </span>
            Push dan BSTB
          </h1>
        </div>
        <p className="ph-sub">Barang pindah dari Stand By ke Unit berikutnya. Dokumen dibuat dari Stand By di Workspace Unit{canCreate ? "" : "; Anda hanya dapat melihatnya"}.</p>
      </div>
      <div className="card">
        <div className="qtabs" role="tablist">
          {TABS.map(([s, name]) => (
            <button key={s || "all"} type="button" role="tab" aria-selected={status === s} className={status === s ? "act" : ""} onClick={() => setStatus(s)}>
              {name}
              <span className="n">{all.filter((r) => !s || r.status === s).length}</span>
            </button>
          ))}
        </div>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, unit, atau jenis…" />
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
                    <th style={{ width: 150 }}>Jenis</th>
                    <th style={{ width: 120 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 170 }}>Dari → Ke</th>
                    <th className="num" style={{ width: 70 }}>Baris</th>
                    <th className="num" style={{ width: 96 }}>Gram</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/production/transfer/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/production/transfer/${r.id}`} onClick={(e) => e.stopPropagation()}>
                          {r.no}
                        </Link>
                      </td>
                      <td>{TRANSFER_KIND_TEXT[r.kind]}</td>
                      <td>
                        <span className={`bdg ${r.status === "Submitted" ? "s-warn" : "s-ok"}`}>{r.status === "Submitted" ? "Dalam Perjalanan" : r.kind === "Push" ? "Diposting" : "Diterima"}</span>
                      </td>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <span className="lab">{r.fromLabel}</span> → <span className="lab">{r.toLabel}</span>
                      </td>
                      <td className="num">{r.lines}</td>
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
              <Icon name="truck" size={18} />
            </div>
            <h4>Belum ada dokumen</h4>
            <p>Buka Stand By sebuah Unit di Workspace dan klik baris barang untuk mengirimnya.</p>
          </div>
        )}
      </div>
    </>
  );
}
