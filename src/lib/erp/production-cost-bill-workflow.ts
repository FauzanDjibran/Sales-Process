/**
 * The Tagihan Biaya's lifecycle, written once and read by both sides
 * (P150 M68, production_project.md §21d).
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting recognises the cost in the month the bill is dated: Dr each line's
 * Jenis Biaya expense account with its Cost Center / Cr the Jenis Biaya's own
 * credit account (P154). A posted bill is final; a mistake is corrected by
 * another document. A paid bill is then paid by the Pengeluaran purpose
 * *Pembayaran Biaya Produksi*, which reads and raises its paid amount.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type CostBillStatus = "Draft" | "Posted" | "Cancelled";

export type CostBillAction = "post" | "cancel";

export const COST_BILL_ACTIONS: CostBillAction[] = ["cancel", "post"];

export const COST_BILL_PATH = "/production/cost-bill";

export type CostBillTransition = {
  label: string;
  permission: PermissionCode;
  from: CostBillStatus[];
  to: CostBillStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const COST_BILL_TRANSITIONS: Record<CostBillAction, CostBillTransition> = {
  post: {
    label: "Posting",
    permission: "PRODUCTION_COST_BILL_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "send",
    tone: "primary",
    title: "Posting Tagihan Biaya",
    body:
      "Biaya diakui pada tanggal tagihan: journal di bawah ditulis, setiap baris biaya " +
      "dengan Cost Center-nya. Tagihan yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Tagihan Biaya diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "PRODUCTION_COST_BILL_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Tagihan Biaya",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada journal yang dibuat. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa tagihan ini dibatalkan…",
    done: "Tagihan Biaya dibatalkan",
  },
};

export function costBillTransitionAllowed(action: CostBillAction, status: CostBillStatus): boolean {
  return COST_BILL_TRANSITIONS[action].from.includes(status);
}

export function costBillIsEditable(status: CostBillStatus): boolean {
  return status === "Draft";
}

export type CostBillAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function costBillAbilities(permissions: Iterable<string>): CostBillAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PRODUCTION_COST_BILL_CREATE"),
    edit: held.has("PRODUCTION_COST_BILL_EDIT"),
    post: held.has("PRODUCTION_COST_BILL_POST"),
    cancel: held.has("PRODUCTION_COST_BILL_CANCEL"),
  };
}

export function availableCostBillActions(status: CostBillStatus, can: CostBillAbilities): CostBillAction[] {
  return COST_BILL_ACTIONS.filter((a) => costBillTransitionAllowed(a, status) && can[a]);
}

export const COST_BILL_STATUS_TEXT: Record<CostBillStatus, string> = {
  Draft: "Draft",
  Posted: "Posted",
  Cancelled: "Dibatalkan",
};

export const COST_BILL_STATUS_BADGE: Record<CostBillStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};

/** A payable bill's standing, from what it was paid (P132). */
export type CostBillPayment = "Unpaid" | "Partial" | "Paid";

export function costBillPayment(total: number, paid: number): CostBillPayment {
  if (paid <= 0) return "Unpaid";
  return Math.round(paid * 100) >= Math.round(total * 100) ? "Paid" : "Partial";
}

export const COST_BILL_PAYMENT_TEXT: Record<CostBillPayment, string> = {
  Unpaid: "Belum Dibayar",
  Partial: "Sebagian",
  Paid: "Lunas",
};

export const COST_BILL_PAYMENT_BADGE: Record<CostBillPayment, string> = {
  Unpaid: "s-warn",
  Partial: "s-info",
  Paid: "s-ok",
};
