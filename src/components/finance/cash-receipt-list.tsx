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
import type { CashReceiptListRow } from "@/lib/erp/cash-bank-tx";
import { cashBankPurpose } from "@/lib/erp/cash-bank-purposes";
import {
  CASH_BANK_TX_STATUS_BADGE,
  CASH_BANK_TX_STATUS_TEXT,
  type CashBankTxStatus,
  type CashReceiptAbilities,
} from "@/lib/erp/cash-bank-tx-workflow";

/** The Penerimaan Kas & Bank register. Drafts first, then newest first. */
export function CashReceiptList({ paged, can }: { paged: Paged<CashReceiptListRow>; can: CashReceiptAbilities }) {
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
            <b>{paged.total}</b> penerimaan
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
                    <th className="num" style={{ width: 150 }}>Dana Diterima</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((r) => (
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
              <Icon name="down" size={20} />
            </div>
            <h4>{filtered ? "Tidak ada yang cocok" : "Belum ada penerimaan"}</h4>
            <p>
              {filtered
                ? "Tidak ada penerimaan yang sesuai dengan pencarian atau filter."
                : "Catat dana yang masuk dari customer atas tagihan uang muka."}
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
