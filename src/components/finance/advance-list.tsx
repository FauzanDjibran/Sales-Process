"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { SalesAdvanceListRow } from "@/lib/erp/ar-advance";
import {
  ADVANCE_STATUS_BADGE,
  ADVANCE_STATUS_TEXT,
  ADVANCE_TRANSITIONS_OF,
  advanceIsEditable,
  availableAdvanceActions,
  type AdvanceAbilities,
  type AdvanceStatus,
  type AdvanceVariant,
} from "@/lib/erp/ar-advance-workflow";
import { formatMoney, todayIso } from "@/lib/format";

const LIST_TEXT = {
  sales: {
    title: "Uang Muka Penjualan",
    base: "/finance/advance/sales",
    source: "Customer Order",
    sourceBase: "/sales/customer-order",
    sub: "Tagihan uang muka ke customer atas Customer Order yang Open.",
    empty: "Buat tagihan uang muka dari Customer Order berstatus Open.",
  },
  permit: {
    title: "Uang Muka Perizinan",
    base: "/finance/advance/permit",
    source: "Pengajuan",
    sourceBase: "/sales/permit",
    sub: "Tagihan uang muka ke customer atas Pengajuan Perizinan yang Open.",
    empty: "Buat tagihan uang muka dari Pengajuan Perizinan yang sudah Open.",
  },
} as const;

export type PayState = "Belum Dibayar" | "Sebagian" | "Lunas";

export function payStateOf(total: number, paid: number): PayState {
  return paid >= total ? "Lunas" : paid > 0 ? "Sebagian" : "Belum Dibayar";
}

const PAY_TAG: Record<PayState, string> = { "Belum Dibayar": "t-warn", Sebagian: "t-info", Lunas: "t-ok" };
const STATUSES: AdvanceStatus[] = ["Draft", "Issued", "Cancelled"];

/**
 * The Uang Muka Penjualan and Perizinan registers. An issued bill carries its
 * payment state from what posted receipts settled of it (P132), and one not
 * fully paid past its due date is marked.
 */
export function AdvanceList({
  rows,
  paid,
  can,
  variant = "sales",
}: {
  rows: SalesAdvanceListRow[];
  /** Settled by posted receipts, per bill id. */
  paid: Record<number, number>;
  can: AdvanceAbilities;
  variant?: AdvanceVariant;
}) {
  const T = LIST_TEXT[variant];
  const today = todayIso();
  return (
    <DocumentRegister
      module="Finance"
      icon="wallet"
      title={T.title}
      sub={T.sub}
      base={T.base}
      newLabel={`Buat ${T.title}`}
      canCreate={can.create}
      searchHint={`Cari nomor, ${T.source} atau customer…`}
      statuses={STATUSES}
      statusText={ADVANCE_STATUS_TEXT}
      statusBadge={ADVANCE_STATUS_BADGE}
      partnerLabel="Customer"
      sourceLabel={T.source}
      valueLabel="Nilai"
      payment
      empty={T.empty}
      rows={rows.map((r) => {
        const state = payStateOf(r.total, paid[r.id] ?? 0);
        const issued = r.status === "Issued";
        return {
          id: r.id,
          no: r.advanceNo,
          status: r.status,
          date: r.advanceDate,
          due: r.dueDate,
          overdue: issued && r.dueDate < today && state !== "Lunas",
          partner: { label: r.customerLabel, name: r.customerName },
          source: { no: r.orderNo, href: `${T.sourceBase}/${r.orderId}` },
          value: <Amount value={r.total} currency={r.currency} />,
          pay: issued
            ? { state, text: state, tone: PAY_TAG[state], note: paid[r.id] && state !== "Lunas" ? `dibayar ${formatMoney(paid[r.id], r.currency)}` : undefined }
            : null,
          editable: can.edit && advanceIsEditable(r.status),
          steps: rowSteps(availableAdvanceActions(r.status, can), ADVANCE_TRANSITIONS_OF[variant]),
        };
      })}
    />
  );
}
