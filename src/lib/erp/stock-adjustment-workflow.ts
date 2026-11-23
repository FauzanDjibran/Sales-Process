/**
 * The Stock Adjustment's lifecycle, written once and read by both sides (P318,
 * `Goods-Movement-Plan.md` §3.4).
 *
 *   Draft ──submit──> Submitted ──approve──> Posted
 *     │                  └──reject──> Rejected
 *     └──cancel──> Cancelled
 *
 * Approving posts: what was counted is checked against the books again and the
 * differences move at once, so nothing can slip in between. Tolak and Batalkan
 * ask for a reason and are final.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type StockAdjustmentStatus = "Draft" | "Submitted" | "Posted" | "Rejected" | "Cancelled";
export type StockAdjustmentAction = "submit" | "approve" | "reject" | "cancel";
export const STOCK_ADJUSTMENT_ACTIONS: StockAdjustmentAction[] = ["cancel", "reject", "submit", "approve"];

export type StockAdjustmentTransition = {
  label: string;
  permission: PermissionCode;
  from: StockAdjustmentStatus[];
  to: StockAdjustmentStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  done: string;
};

export const STOCK_ADJUSTMENT_TRANSITIONS: Record<StockAdjustmentAction, StockAdjustmentTransition> = {
  submit: {
    label: "Ajukan",
    permission: "STOCK_ADJUSTMENT_SUBMIT",
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Stock Adjustment",
    body: "Hitungan dikirim untuk disetujui dan tidak dapat diubah lagi. Stok dan journal belum bergerak.",
    confirmLabel: "Ya, Ajukan",
    done: "Stock Adjustment diajukan",
  },
  approve: {
    label: "Setujui & Posting",
    permission: "STOCK_ADJUSTMENT_APPROVE",
    from: ["Submitted"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Setujui Stock Adjustment",
    body: "Selisih hitungan masuk atau keluar stok pada Tanggal, dengan journal di bawah ini. Stock Adjustment yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Setujui",
    done: "Stock Adjustment diposting",
  },
  reject: {
    label: "Tolak",
    permission: "STOCK_ADJUSTMENT_APPROVE",
    from: ["Submitted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak Stock Adjustment",
    body: "Hitungan ditolak dan tidak dapat dipakai lagi. Stok tidak bergerak. Status ini final.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa hitungan ini ditolak…",
    done: "Stock Adjustment ditolak",
  },
  cancel: {
    label: "Batalkan",
    permission: "STOCK_ADJUSTMENT_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Stock Adjustment",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Stock Adjustment ini dibatalkan…",
    done: "Stock Adjustment dibatalkan",
  },
};

export const stockAdjustmentIsEditable = (s: StockAdjustmentStatus) => s === "Draft";

export type StockAdjustmentAbilities = { create: boolean; edit: boolean; submit: boolean; approve: boolean; reject: boolean; cancel: boolean };

export function stockAdjustmentAbilities(permissions: Iterable<string>): StockAdjustmentAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  const approve = held.has("STOCK_ADJUSTMENT_APPROVE");
  return {
    create: held.has("STOCK_ADJUSTMENT_CREATE"),
    edit: held.has("STOCK_ADJUSTMENT_EDIT"),
    submit: held.has("STOCK_ADJUSTMENT_SUBMIT"),
    approve,
    reject: approve,
    cancel: held.has("STOCK_ADJUSTMENT_CANCEL"),
  };
}

export function availableStockAdjustmentActions(status: StockAdjustmentStatus, can: StockAdjustmentAbilities): StockAdjustmentAction[] {
  return STOCK_ADJUSTMENT_ACTIONS.filter((a) => STOCK_ADJUSTMENT_TRANSITIONS[a].from.includes(status) && can[a]);
}

export const STOCK_ADJUSTMENT_STATUS_TEXT: Record<StockAdjustmentStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  Posted: "Diposting",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
};

export const STOCK_ADJUSTMENT_STATUS_BADGE: Record<StockAdjustmentStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
  Posted: "s-ok",
  Rejected: "s-bad",
  Cancelled: "s-mute",
};
