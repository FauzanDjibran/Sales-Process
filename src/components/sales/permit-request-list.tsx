"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { PermitRequestListRow } from "@/lib/erp/permit-request";
import {
  PERMIT_REQUEST_STATUS_BADGE,
  PERMIT_REQUEST_STATUS_TEXT,
  type PermitRequestAbilities,
  type PermitRequestStatus,
} from "@/lib/erp/permit-request-workflow";

/**
 * The Pengajuan Perizinan register (P137). Drafts sort first — they are the rows somebody
 * still has something to do about — then newest first.
 */
export function PermitRequestList({ requests, can }: { requests: PermitRequestListRow[]; can: PermitRequestAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = requests.filter(
      (o) =>
        (!status || o.status === status) &&
        (!q ||
          o.requestNo.toLowerCase().includes(q) ||
          o.customerLabel.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.productName.toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [requests, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Penjualan</span>
          <span>/</span>
          <span>Perizinan</span>
          <span>/</span>
          <span className="cur">Pengajuan Perizinan</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="clip" size={16} />
            </span>
            Pengajuan Perizinan
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/sales/permit/new">
                <Icon name="plus" size={15} /> Pengajuan Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Perizinan yang diurus untuk produk customer maklon: estimasi setiap perizinan, lalu realisasinya.
          Tidak memposting apa pun; setelah disetujui menjadi dasar Uang Muka Perizinan, dan realisasinya
          menjadi dasar Biaya Perizinan dan Invoice Perizinan.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, customer atau produk…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Submitted", "Open", "Realized", "Done", "Cancelled", "Rejected"] as PermitRequestStatus[]).map((s) => ({
                value: s,
                label: PERMIT_REQUEST_STATUS_TEXT[s],
              })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> pengajuan
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
                    <th>Produk</th>
                    <th style={{ width: 170 }}>Realisasi</th>
                    <th className="num" style={{ width: 170 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/sales/permit/${o.id}`)}>
                      <td>
                        <Link className="lab" href={`/sales/permit/${o.id}`}>
                          {o.requestNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${PERMIT_REQUEST_STATUS_BADGE[o.status]}`}>
                          {PERMIT_REQUEST_STATUS_TEXT[o.status]}
                        </span>
                      </td>
                      <td>{formatDate(o.requestDate)}</td>
                      <td>
                        <span className="idc">
                          <span className="lab">{o.customerLabel}</span>
                          <span className="nm">{o.customerName}</span>
                        </span>
                      </td>
                      <td>{o.productName}</td>
                      <td>{o.realizationNo ? <span className="mono">{o.realizationNo}</span> : <span className="dash">—</span>}</td>
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
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Pengajuan Perizinan"}</h4>
            <p>
              {q || status
                ? "Tidak ada Pengajuan yang sesuai dengan pencarian atau filter."
                : "Buat pengajuan pertama — mulai dari memilih customer."}
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
                  <Link className="btn primary" href="/sales/permit/new">
                    <Icon name="plus" size={15} /> Pengajuan Baru
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
