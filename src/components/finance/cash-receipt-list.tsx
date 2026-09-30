"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { CashReceiptListRow } from "@/lib/erp/cash-bank-tx";
import { cashBankPurpose } from "@/lib/erp/cash-bank-purposes";
import {
  CASH_BANK_TX_STATUS_BADGE,
  CASH_BANK_TX_STATUS_TEXT,
  type CashBankTxStatus,
  type CashReceiptAbilities,
} from "@/lib/erp/cash-bank-tx-workflow";

/** The Penerimaan Kas & Bank register. Drafts first, then newest first. */
export function CashReceiptList({ rows: all, can }: { rows: CashReceiptListRow[]; can: CashReceiptAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q ||
          r.txNo.toLowerCase().includes(q) ||
          (r.bankRef ?? "").toLowerCase().includes(q) ||
          r.partnerLabel.toLowerCase().includes(q) ||
          r.partnerName.toLowerCase().includes(q) ||
          r.docs.some((d) => d.toLowerCase().includes(q)))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);
  const money = (n: number) => formatMoney(n, "IDR");

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span>Kas & Bank</span>
          <span>/</span>
          <span className="cur">Penerimaan</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="down" size={16} />
            </span>
            Penerimaan Kas & Bank
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/finance/cash-bank/receipt/new">
                <Icon name="plus" size={15} /> Penerimaan Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Setiap dana yang masuk ke kas atau bank. Tujuannya menentukan dokumen yang dilunasi; satu penerimaan dapat
          melunasi beberapa tagihan partner yang sama. Posting membentuk journal dan mencatat dana di Buku Kas & Bank.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, referensi bank, partner atau tagihan…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as CashBankTxStatus[]).map((s) => ({
                value: s,
                label: CASH_BANK_TX_STATUS_TEXT[s],
              })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> penerimaan
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 100 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th>Partner / Dokumen</th>
                    <th style={{ width: 170 }}>Tujuan</th>
                    <th style={{ width: 110 }}>Kas & Bank</th>
                    <th className="num" style={{ width: 130 }}>PPh</th>
                    <th className="num" style={{ width: 150 }}>Dana Diterima</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/finance/cash-bank/receipt/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/finance/cash-bank/receipt/${r.id}`}>
                          {r.txNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${CASH_BANK_TX_STATUS_BADGE[r.status]}`}>{CASH_BANK_TX_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.date)}</td>
                      <td>
                        <span className="dstack">
                          <span className="d1">{r.partnerName}</span>
                          <span className="d2">
                            {r.docs.join(", ")}
                            {r.bankRef ? ` · ref ${r.bankRef}` : ""}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="bdg t-vio">{cashBankPurpose(r.purpose)?.short ?? r.purpose}</span>
                      </td>
                      <td>
                        <span className="lab">{r.cashBankLabel}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{r.pph ? money(r.pph) : "—"}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{money(r.cash)}</span>
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
              <Icon name="down" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada penerimaan"}</h4>
            <p>
              {q || status
                ? "Tidak ada penerimaan yang sesuai dengan pencarian atau filter."
                : "Catat dana yang masuk dari customer atas tagihan uang muka."}
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
                  <Link className="btn primary" href="/finance/cash-bank/receipt/new">
                    <Icon name="plus" size={15} /> Penerimaan Baru
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
