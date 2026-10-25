/**
 * The Rencana Produksi's lifecycle, written once and read by both sides (P168).
 *
 *   Draft ──submit──> Submitted ──approve──> Open (Disetujui) ──close──> Closed
 *     │                   │
 *     │                   └──reject──> Rejected
 *     └──cancel──> Cancelled
 *
 * Ajukan locks the plan's lines and reserves the Sales Order quantities they
 * cover; Setujui makes it Open, so Perintah Produksi may be made from its lines.
 * Tutup closes it by hand with a reason, refused while a Perintah made from it is
 * still a Draft or Open. A plan posts nothing at any step.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type ProductionPlanStatus = "Draft" | "Submitted" | "Open" | "Closed" | "Cancelled" | "Rejected";

export type ProductionPlanAction = "submit" | "approve" | "reject" | "cancel" | "close";

export const PRODUCTION_PLAN_ACTIONS: ProductionPlanAction[] = ["cancel", "reject", "close", "submit", "approve"];

export type ProductionPlanTransition = {
  label: string;
  permission: PermissionCode;
  from: ProductionPlanStatus[];
  to: ProductionPlanStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const PRODUCTION_PLAN_TRANSITIONS: Record<ProductionPlanAction, ProductionPlanTransition> = {
  submit: {
    label: "Ajukan",
    permission: "PRODUCTION_PLAN_SUBMIT",
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Rencana Produksi",
    body:
      "Rencana dikunci dan menunggu persetujuan: barang, jumlah dan tanggal mulai tidak dapat diubah lagi, " +
      "dan jumlah Sales Order yang dicakup dicadangkan agar tidak direncanakan dua kali. Tidak ada journal yang dibuat.",
    confirmLabel: "Ya, Ajukan",
    done: "Rencana diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "PRODUCTION_PLAN_APPROVE",
    from: ["Submitted"],
    to: "Open",
    icon: "check",
    tone: "primary",
    title: "Setujui Rencana Produksi",
    body: "Rencana menjadi Disetujui: Perintah Produksi dapat dibuat dari barisnya. Tidak ada journal yang dibuat.",
    confirmLabel: "Ya, Setujui",
    done: "Rencana disetujui",
  },
  reject: {
    label: "Tolak",
    permission: "PRODUCTION_PLAN_APPROVE",
    from: ["Submitted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak Rencana Produksi",
    body: "Rencana ditolak dan jumlah Sales Order yang dicadangkan dilepas. Status ini final; susun ulang dengan rencana baru.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa rencana ini ditolak…",
    done: "Rencana ditolak",
  },
  cancel: {
    label: "Batalkan",
    permission: "PRODUCTION_PLAN_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Rencana Produksi",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa rencana ini dibatalkan…",
    done: "Rencana dibatalkan",
  },
  close: {
    label: "Tutup Rencana",
    permission: "PRODUCTION_PLAN_CLOSE",
    from: ["Open"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Rencana Produksi",
    body:
      "Rencana ditutup: tidak ada Perintah Produksi baru darinya, dan jumlah Sales Order yang dicadangkan dilepas. " +
      "Ditolak selama masih ada Perintah Produksi Draft atau Open darinya.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa rencana ini ditutup…",
    done: "Rencana ditutup",
  },
};

export function productionPlanTransitionAllowed(action: ProductionPlanAction, status: ProductionPlanStatus): boolean {
  return PRODUCTION_PLAN_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited. */
export function productionPlanIsEditable(status: ProductionPlanStatus): boolean {
  return status === "Draft";
}

/** A plan whose Sales Order quantities are reserved: submitted or approved. */
export function productionPlanIsLive(status: ProductionPlanStatus): boolean {
  return status === "Submitted" || status === "Open";
}

export type ProductionPlanAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  close: boolean;
  /** Perintah Produksi may be made from an approved plan. */
  release: boolean;
};

export function productionPlanAbilities(permissions: Iterable<string>): ProductionPlanAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PRODUCTION_PLAN_CREATE"),
    edit: held.has("PRODUCTION_PLAN_EDIT"),
    submit: held.has("PRODUCTION_PLAN_SUBMIT"),
    approve: held.has("PRODUCTION_PLAN_APPROVE"),
    reject: held.has("PRODUCTION_PLAN_APPROVE"),
    cancel: held.has("PRODUCTION_PLAN_CANCEL"),
    close: held.has("PRODUCTION_PLAN_CLOSE"),
    release: held.has("PRODUCTION_ORDER_CREATE"),
  };
}

export function availableProductionPlanActions(status: ProductionPlanStatus, can: ProductionPlanAbilities): ProductionPlanAction[] {
  return PRODUCTION_PLAN_ACTIONS.filter((a) => productionPlanTransitionAllowed(a, status) && can[a]);
}

export const PRODUCTION_PLAN_STATUS_TEXT: Record<ProductionPlanStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  Open: "Disetujui",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
};

export const PRODUCTION_PLAN_STATUS_BADGE: Record<ProductionPlanStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
  Open: "s-ok",
  Closed: "s-mute",
  Cancelled: "s-mute",
  Rejected: "s-bad",
};

/** Months, for the period picker: `2026-11` → first day, and back. */
export const periodStart = (ym: string) => `${ym}-01`;
export const periodOf = (iso: string) => iso.slice(0, 7);
