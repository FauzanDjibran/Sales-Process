"use client";

import { CashBalanceTile } from "@/components/finance/cash-balance-tile";
import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { CashBookSummary } from "@/lib/erp/cash-bank";
import type { CashTransferView } from "@/lib/erp/cash-transfer";
import {
  CASH_TRANSFER_PATH,
  CASH_TRANSFER_PURPOSE_TEXT,
  CASH_TRANSFER_STATUS_BADGE,
  CASH_TRANSFER_STATUS_TEXT,
  CASH_TRANSFER_TRANSITIONS,
  availableCashTransferActions,
  cashTransferIsEditable,
  type CashTransferAbilities,
  type CashTransferStatus,
} from "@/lib/erp/cash-transfer-workflow";

const STATUSES: CashTransferStatus[] = ["Draft", "Posted", "Cancelled"];

/** The Transfer Kas & Bank register (P299). */
export function CashTransferList({ rows, can, cash }: { rows: CashTransferView[]; can: CashTransferAbilities; cash: CashBookSummary }) {
  return (
    <DocumentRegister
      module="Finance"
      icon="link"
      title="Transfer"
      sub="Pemindahan dana antar Kas & Bank sendiri, termasuk jual dan beli valas."
      base={CASH_TRANSFER_PATH}
      newLabel="Buat Transfer"
      canCreate={can.create}
      searchHint="Cari nomor, Kas & Bank atau referensi…"
      statuses={STATUSES}
      statusText={CASH_TRANSFER_STATUS_TEXT}
      statusBadge={CASH_TRANSFER_STATUS_BADGE}
      columns={[
        { key: "purpose", label: "Tujuan", width: 104 },
        { key: "from", label: "Dari", width: 96 },
        { key: "to", label: "Ke", width: 96 },
        { key: "out", label: "Keluar", width: 120, num: true },
      ]}
      valueLabel="Jumlah"
      empty="Catat pemindahan dana antar Kas & Bank, pencairan valas, atau pembelian valas."
      banner={
        <div className="kpis bud">
          <CashBalanceTile cash={cash} />
        </div>
      }
      rows={rows.map((r) => ({
        id: r.id,
        no: r.transferNo,
        status: r.status,
        date: r.transferDate,
        cells: {
          purpose: CASH_TRANSFER_PURPOSE_TEXT[r.purpose],
          from: <span className="lab">{r.from.label}</span>,
          to: r.lines.length === 1 ? <span className="lab">{r.lines[0].to.label}</span> : `${r.lines.length} tujuan`,
          out: <Amount value={r.fromAmount} currency={r.from.currency} />,
        },
        value: <Amount value={r.transferAmount} currency={r.currency} />,
        search: [r.from.label, ...r.lines.map((l) => l.to.label), r.reference ?? ""].join(" "),
        editable: can.edit && cashTransferIsEditable(r.status),
        steps: rowSteps(availableCashTransferActions(r.status, can), CASH_TRANSFER_TRANSITIONS),
      }))}
    />
  );
}
