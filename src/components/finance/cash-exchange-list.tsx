"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { CashExchangeView } from "@/lib/erp/cash-exchange";
import {
  CASH_EXCHANGE_KIND_TEXT,
  CASH_EXCHANGE_PATH,
  CASH_EXCHANGE_STATUS_BADGE,
  CASH_EXCHANGE_STATUS_TEXT,
  type CashExchangeAbilities,
  type CashExchangeStatus,
} from "@/lib/erp/cash-exchange-workflow";

/** The Penukaran Valas register (MC11a). Drafts first, then newest first. */
export function CashExchangeList({ rows: all, can }: { rows: CashExchangeView[]; can: CashExchangeAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || [r.exchangeNo, r.from.label, r.to.label, r.reference ?? ""].some((s) => s.toLowerCase().includes(q)))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);
  const newButton = (
    <Link className="btn primary" href={`${CASH_EXCHANGE_PATH}/new`}>
      <Icon name="plus" size={15} /> Penukaran Valas Baru
    </Link>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span className="cur">Penukaran Valas</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="coin" size={16} />
            </span>
            Penukaran Valas
          </h1>
          <div className="ph-act">{can.create && newButton}</div>
        </div>
        <p className="ph-sub">
          Pembelian valas dari rupiah dan pencairan valas ke rupiah, antara dua Kas &amp; Bank. Tagihan dilunasi dalam mata uangnya sendiri;
          perpindahan antar mata uang hanya lewat menu ini.
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
              ...(["Draft", "Posted", "Cancelled"] as CashExchangeStatus[]).map((s) => ({ value: s, label: CASH_EXCHANGE_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> penukaran
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
                    <th style={{ width: 140 }}>Jenis</th>
                    <th>Dari</th>
                    <th className="num" style={{ width: 160 }}>
                      Keluar
                    </th>
                    <th>Ke</th>
                    <th className="num" style={{ width: 160 }}>
                      Masuk
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`${CASH_EXCHANGE_PATH}/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`${CASH_EXCHANGE_PATH}/${r.id}`}>
                          {r.exchangeNo}
                        </Link>
                      </td>
                      <td>
                        <span className={`bdg ${CASH_EXCHANGE_STATUS_BADGE[r.status]}`}>{CASH_EXCHANGE_STATUS_TEXT[r.status]}</span>
                      </td>
                      <td>{formatDate(r.exchangeDate)}</td>
                      <td>{r.kind ? CASH_EXCHANGE_KIND_TEXT[r.kind] : <span className="dash">—</span>}</td>
                      <td>
                        <span className="lab">{r.from.label}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{formatMoney(r.fromAmount, r.from.currency)}</span>
                      </td>
                      <td>
                        <span className="lab">{r.to.label}</span>
                      </td>
                      <td className="num">
                        <span className="mny">{formatMoney(r.toAmount, r.to.currency)}</span>
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
              <Icon name="coin" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Penukaran Valas"}</h4>
            <p>
              {q || status
                ? "Tidak ada penukaran yang sesuai dengan pencarian atau filter."
                : "Catat pembelian valas ke Kas & Bank valas, atau pencairannya kembali ke rupiah."}
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
