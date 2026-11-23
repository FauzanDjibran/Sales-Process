"use client";

import { Amount } from "@/components/ui/amount";
import { DocumentRegister, rowSteps } from "@/components/ui/document-register";
import type { PurchaseAdvanceListRow } from "@/lib/erp/ap-advance";
import {
  ADVANCE_STATUS_BADGE,
  ADVANCE_STATUS_TEXT,
  PURCHASE_ADVANCE_TRANSITIONS,
  advanceIsEditable,
  availablePurchaseAdvanceActions,
  type AdvanceAbilities,
  type AdvanceStatus,
} from "@/lib/erp/ap-advance-workflow";
import { formatMoney, todayIso } from "@/lib/format";

export type PayState = "Belum Dibayar" | "Sebagian" | "Lunas";

export function payStateOf(total: number, paid: number): PayState {
  return paid >= total ? "Lunas" : paid > 0 ? "Sebagian" : "Belum Dibayar";
}

const PAY_TAG: Record<PayState, string> = { "Belum Dibayar": "t-warn", Sebagian: "t-info", Lunas: "t-ok" };
const STATUSES: AdvanceStatus[] = ["Draft", "Issued", "Cancelled"];

/** The Uang Muka Pembelian register: a bill's payment state is what posted payments settled of it. */
export function PurchaseAdvanceList({
  rows,
  paid,
  can,
}: {
  rows: PurchaseAdvanceListRow[];
  /** Settled by posted payments, per bill id. */
  paid: Record<number, number>;
  can: AdvanceAbilities;
}) {
  const today = todayIso();
  return (
    <DocumentRegister
      module="Finance"
      icon="wallet"
      title="Uang Muka Pembelian"
      sub="Tagihan uang muka dari supplier atas Purchase Order yang Open."
      base="/finance/advance/purchase"
      newLabel="Buat Uang Muka Pembelian"
      canCreate={can.create}
      searchHint="Cari nomor, Purchase Order atau supplier…"
      statuses={STATUSES}
      statusText={ADVANCE_STATUS_TEXT}
      statusBadge={ADVANCE_STATUS_BADGE}
      partnerLabel="Supplier"
      sourceLabel="Purchase Order"
      valueLabel="Nilai"
      payment
      empty="Buat tagihan uang muka dari Purchase Order berstatus Open."
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
          partner: { label: r.supplierLabel, name: r.supplierName },
          source: { no: r.orderNo, href: `/purchasing/order/goods/${r.orderId}` },
          value: <Amount value={r.total} currency={r.currency} />,
          pay: issued
            ? { state, text: state, tone: PAY_TAG[state], note: paid[r.id] && state !== "Lunas" ? `dibayar ${formatMoney(paid[r.id], r.currency)}` : undefined }
            : null,
          editable: can.edit && advanceIsEditable(r.status),
          steps: rowSteps(availablePurchaseAdvanceActions(r.status, can), PURCHASE_ADVANCE_TRANSITIONS),
        };
      })}
    />
  );
}
