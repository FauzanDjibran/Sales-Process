"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Pager } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { useRegisterParams } from "@/components/ui/use-register-params";
import type { Paged } from "@/lib/erp/register-query";
import { formatDate, formatMoney } from "@/lib/format";
import type { CashPaymentListRow } from "@/lib/erp/cash-payment";
import { cashBankPurpose } from "@/lib/erp/cash-bank-purposes";
import { CashBalanceTile } from "@/components/finance/cash-balance-tile";
import type { CashBookSummary } from "@/lib/erp/cash-bank";
import {
  CASH_BANK_TX_STATUS_BADGE,
  CASH_BANK_TX_STATUS_TEXT,
  type CashBankTxStatus,
  type CashPaymentAbilities,
} from "@/lib/erp/cash-bank-tx-workflow";

/** The Pengeluaran Kas & Bank register. Drafts first, then newest first. */
export function CashPaymentList({ paged, can, cash }: { paged: Paged<CashPaymentListRow>; can: CashPaymentAbilities; cash: CashBookSummary }) {
  const router = useRouter();
  const reg = useRegisterParams();
  const filtered = Boolean(reg.q || reg.status);
  const money = (n: number) => formatMoney(n, "IDR");

  return (
    <>
      <div className="ph">
        <div className="crumb">
          <span>Finance</span>
          <span>/</span>
          <span>Kas & Bank</span>
          <span>/</span>
          <span className="cur">Pengeluaran</span>
        </div>
        <div className="ph-row">
          <h1>
            <span className="ph-ico">
              <Icon name="send" size={16} />
            </span>
            Pengeluaran Kas & Bank
          </h1>
          <div className="ph-act">
            {can.create && (
              <Link className="btn primary" href="/finance/cash-bank/payment/new">
                <Icon name="plus" size={15} /> Pengeluaran Baru
              </Link>
            )}
          </div>
        </div>
        <p className="ph-sub">
          Setiap dana yang keluar dari kas atau bank. Tujuannya menentukan dokumen yang dilunasi; satu pengeluaran dapat
          melunasi beberapa tagihan partner yang sama. Posting membentuk journal dan mengeluarkan dana dari Buku Kas & Bank.
        </p>
      </div>

      <div className="kpis bud">
        <CashBalanceTile cash={cash} />
      </div>

      <div className="card">
        <div className="toolbar">
          <SearchField value={reg.search.value} onChange={reg.search.onChange} placeholder="Cari nomor, referensi bank atau partner…" />
          <Select
            variant="toolbar"
            value={reg.status}
            set={Boolean(reg.status)}
            options={[
              { value: "", label: "Status: semua" },
              ...(["Draft", "Posted", "Cancelled"] as CashBankTxStatus[]).map((s) => ({
                value: s,
                label: CASH_BANK_TX_STATUS_TEXT[s],
              })),
            ]}
            onChange={reg.setStatus}
          />
          <span className="tspace" />
          <span className="count">
            <b>{paged.total}</b> pengeluaran
          </span>
        </div>

        {paged.total ? (
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
                    <th className="num" style={{ width: 150 }}>Dana Keluar</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/finance/cash-bank/payment/${r.id}`)}>
                      <td>
                        <Link className="lab" href={`/finance/cash-bank/payment/${r.id}`}>
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
              page={paged.page}
              pages={paged.pages}
              total={paged.total}
              perPage={paged.size}
              onPage={reg.setPage}
              onPerPage={reg.setSize}
            />
          </>
        ) : (
          <div className="empty">
            <div className="ic">
              <Icon name="send" size={20} />
            </div>
            <h4>{filtered ? "Tidak ada yang cocok" : "Belum ada pengeluaran"}</h4>
            <p>
              {filtered
                ? "Tidak ada pengeluaran yang sesuai dengan pencarian atau filter."
                : "Catat dana yang dibayarkan ke supplier atas tagihannya."}
            </p>
            {filtered ? (
              <div className="cta">
                <button
                  className="btn"
                  onClick={() => reg.clear()}
                >
                  Bersihkan filter
                </button>
              </div>
            ) : (
              can.create && (
                <div className="cta">
                  <Link className="btn primary" href="/finance/cash-bank/payment/new">
                    <Icon name="plus" size={15} /> Pengeluaran Baru
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
