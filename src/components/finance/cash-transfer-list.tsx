"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { CashTransferView } from "@/lib/erp/cash-transfer";
import {
  CASH_TRANSFER_PURPOSE_TEXT,
  CASH_TRANSFER_PATH,
  CASH_TRANSFER_STATUS_BADGE,
  CASH_TRANSFER_STATUS_TEXT,
  type CashTransferAbilities,
  type CashTransferStatus,
} from "@/lib/erp/cash-transfer-workflow";

/** The Transfer Kas & Bank register (P299). Drafts first, then newest first. */
export function CashTransferList({ rows: all, can }: { rows: CashTransferView[]; can: CashTransferAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || [r.transferNo, r.from.label, ...r.lines.map((l) => l.to.label), r.reference ?? ""].some((s) => s.toLowerCase().includes(q)))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);
  const newButton = (
    <Link className="btn primary" href={`${CASH_TRANSFER_PATH}/new`}>
      <Icon name="plus" size={15} /> Transfer Baru
    </Link>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span className="cur">Transfer</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="link" size={16} />
            </span>
            Transfer
          </h1>
          <div className="ph-act">{can.create && newButton}</div>
        </div>
        <p className="ph-sub">
          Pemindahan dana antar Kas &amp; Bank sendiri: transfer satu mata uang, pencairan valas ke rupiah, dan pembelian valas. Tagihan dilunasi
          dalam mata uangnya sendiri; perpindahan antar mata uang hanya lewat menu ini.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, Kas & Bank atau referensi…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as CashTransferStatus[]).map((s) => ({ value: s, label: CASH_TRANSFER_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> transfer
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th style={{ width: 140 }}>Tujuan Transfer</th>
                    <th>Dari</th>
                    <th className="num" style={{ width: 160 }}>
                      Keluar
                    </th>
                    <th>Ke</th>
                    <th className="num" style={{ width: 160 }}>
                      Jumlah
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`${CASH_TRANSFER_PATH}/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`${CASH_TRANSFER_PATH}/${r.id}`}>
                          {r.transferNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${CASH_TRANSFER_STATUS_BADGE[r.status]}`}>{CASH_TRANSFER_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.transferDate)}</td>
                      <td>{CASH_TRANSFER_PURPOSE_TEXT[r.purpose]}</td>
                      <td>
                        <span className="lab">{r.from.label}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{formatMoney(r.fromAmount, r.from.currency)}</span>
                      </td>
                      <td>
                        {r.lines.length === 1 ? <span className="lab">{r.lines[0].to.label}</span> : <span>{r.lines.length} tujuan</span>}
                      </td>
                      <td className="num">
                        <span className="mny">{formatMoney(r.transferAmount, r.currency)}</span>
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
              <Icon name="link" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Transfer"}</h4>
            <p>
              {q || status
                ? "Tidak ada transfer yang sesuai dengan pencarian atau filter."
                : "Catat pemindahan dana antar Kas & Bank, pencairan valas, atau pembelian valas."}
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
