"use client";

import { CashBalanceTile } from "@/components/finance/cash-balance-tile";
import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { CashBookSummary } from "@/lib/erp/cash-bank";
import { cashBankPurpose } from "@/lib/erp/cash-bank-purposes";
import type { CashReceiptListRow } from "@/lib/erp/cash-bank-tx";
import {
  CASH_BANK_TX_STATUS_BADGE,
  CASH_BANK_TX_STATUS_TEXT,
  CASH_RECEIPT_TRANSITIONS,
  availableCashReceiptActions,
  cashBankTxIsEditable,
  type CashReceiptAbilities,
  type CashBankTxStatus,
} from "@/lib/erp/cash-bank-tx-workflow";
import type { Paged } from "@/lib/erp/register-query";
import { formatMoney } from "@/lib/format";

const STATUSES: CashBankTxStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Penerimaan Kas & Bank register, paged by the database (P224). */
export function CashReceiptList({ paged, can, cash }: { paged: Paged<CashReceiptListRow>; can: CashReceiptAbilities; cash: CashBookSummary }) {
  return (
    <DocumentRegister
      module="Finance"
      icon="down"
      title="Penerimaan"
      sub="Dana yang masuk ke kas atau bank, dan tagihan yang dilunasinya."
      base="/finance/cash-bank/receipt"
      newLabel="Buat Penerimaan"
      canCreate={can.create}
      searchHint="Cari nomor, referensi bank atau partner…"
      statuses={STATUSES}
      statusText={CASH_BANK_TX_STATUS_TEXT}
      statusBadge={CASH_BANK_TX_STATUS_BADGE}
      partnerLabel="Partner"
      sourceLabel="Tagihan"
      columns={[{ key: "purpose", label: "Tujuan / Kas & Bank", width: 150 }]}
      valueLabel="Nilai"
      empty="Catat dana yang masuk dari customer atas tagihannya."
      banner={
        <div className="kpis bud">
          <CashBalanceTile cash={cash} />
        </div>
      }
      paged={paged}
      rows={paged.rows.map((r) => ({
        id: r.id,
        no: r.txNo,
        status: r.status,
        date: r.date,
        partner: { label: r.partnerLabel, name: r.partnerName },
        source: r.docs.length ? { no: r.docs[0], note: r.docs.length > 1 ? `+${r.docs.length - 1} lainnya` : undefined } : null,
        cells: {
          purpose: (
            <>
              <span className="bdg t-vio">{cashBankPurpose(r.purpose)?.short ?? r.purpose}</span>
              <span className="rsub">{[r.cashBankLabel, r.bankRef].filter(Boolean).join(" · ")}</span>
            </>
          ),
        },
        value: (
          <>
            <Amount value={r.cash} currency={r.currency} />
            {r.pph > 0 && <span className="rsub">PPh {formatMoney(r.pph, r.currency)}</span>}
          </>
        ),
        editable: can.edit && cashBankTxIsEditable(r.status),
        steps: rowSteps(availableCashReceiptActions(r.status, can), CASH_RECEIPT_TRANSITIONS),
      }))}
    />
  );
}
