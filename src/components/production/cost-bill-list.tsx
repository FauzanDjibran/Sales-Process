"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager, usePaging } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import type { CostBillListRow } from "@/lib/erp/production-cost-bill";
import {
  COST_BILL_PATH,
  COST_BILL_PAYMENT_BADGE,
  COST_BILL_PAYMENT_TEXT,
  COST_BILL_STATUS_BADGE,
  COST_BILL_STATUS_TEXT,
  costBillPayment,
  type CostBillAbilities,
  type CostBillStatus,
} from "@/lib/erp/production-cost-bill-workflow";

/**
 * The Tagihan Biaya Produksi register (P150 M68). Drafts sort first — somebody
 * still has something to do about them — then newest first. A payable bill
 * shows what it was paid.
 */
export function CostBillList({ rows: all, can }: { rows: CostBillListRow[]; can: CostBillAbilities }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || r.billNo.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || (r.partnerName ?? "").toLowerCase().includes(q))
    );
    return out.sort((a, b) => Number(b.status === "Draft") - Number(a.status === "Draft"));
  }, [all, q, status]);
  const paging = usePaging(rows, `${q}|${status}`);
  const newButton = (
    <Link className="btn primary" href={`${COST_BILL_PATH}/new`}>
      <Icon name="plus" size={15} /> Tagihan Biaya Produksi Baru
    </Link>
  );

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Produksi</span>
          <span>/</span>
          <span className="cur">Tagihan Biaya Produksi</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="file" size={16} />
            </span>
            Tagihan Biaya Produksi
          </h1>
          <div className="ph-act">{can.create && newButton}</div>
        </div>
        <p className="ph-sub">
          Tagihan supplier atas biaya tenaga kerja dan overhead produksi, dicatat pada bulan terjadinya per Elemen Biaya Produksi
          ke Hutang Biaya Produksi, lalu dibayar lewat Pengeluaran — Pembayaran Biaya Produksi.
        </p>
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor, uraian atau supplier…" />
          <Select
            variant="toolbar"
            value={status}
            set={Boolean(status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as CostBillStatus[]).map((s) => ({ value: s, label: COST_BILL_STATUS_TEXT[s] })),
            ]}
            onChange={setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{rows.length}</b> tagihan
          </span>
        </div>

        {rows.length ? (
          <>
            <div className="tw">
              <table className="grid" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Nomor</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 100 }}>Tanggal</th>
                    <th>Uraian</th>
                    <th style={{ width: 200 }}>Supplier</th>
                    <th className="num" style={{ width: 150 }}>
                      Total
                    </th>
                    <th style={{ width: 130 }}>Pembayaran</th>
                  </tr>
                </thead>
                <tbody>
                  {paging.pageRows.map((r) => {
                    const pay = costBillPayment(r.total, r.paid);
                    return (
                      <tr key={r.id} onClick={() => router.push(`${COST_BILL_PATH}/${r.id}`)}>
                        <td>
                          <Link className="lab" href={`${COST_BILL_PATH}/${r.id}`}>
                            {r.billNo}
                          </Link>
                        </td>
                        <td>
                          <span className={`bdg ${COST_BILL_STATUS_BADGE[r.status]}`}>{COST_BILL_STATUS_TEXT[r.status]}</span>
                        </td>
                        <td>{formatDate(r.billDate)}</td>
                        <td className="trunc">{r.description}</td>
                        <td>{r.partnerName ?? <span className="dash">—</span>}</td>
                        <td className="num">
                          <span className="mny">{formatMoney(r.total, "IDR")}</span>
                        </td>
                        <td>
                          {r.isPayable && r.status === "Posted" ? (
                            <span className={`bdg ${COST_BILL_PAYMENT_BADGE[pay]}`}>{COST_BILL_PAYMENT_TEXT[pay]}</span>
                          ) : (
                            <span className="dash">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
              <Icon name="file" size={20} />
            </div>
            <h4>{q || status ? "Tidak ada yang cocok" : "Belum ada Tagihan Biaya Produksi"}</h4>
            <p>
              {q || status
                ? "Tidak ada tagihan yang sesuai dengan pencarian atau filter."
                : "Catat biaya produksi bulan ini — upah, listrik pabrik, penyusutan mesin — per Elemen Biaya Produksi."}
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
