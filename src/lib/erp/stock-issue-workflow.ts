/**
 * The BSTB Issue's lifecycle, written once and read by both sides (R4).
 *
 *   Draft ──submit──> Submitted ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Ajukan locks the goods at the warehouse and moves nothing (W20). Terima is
 * the moment they leave: each lot is issued through the stock books and enters
 * the Unit's Persiapan, with one journal Dr WIP / Cr Persediaan. No QC here
 * (W22). A received issue is final. Batalkan is for a Draft only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type StockIssueStatus = "Draft" | "Submitted" | "Posted" | "Cancelled";

export type StockIssueAction = "submit" | "post" | "cancel";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const STOCK_ISSUE_ACTIONS: StockIssueAction[] = ["cancel", "submit", "post"];

export type StockIssueTransition = {
  label: string;
  permission: PermissionCode;
  from: StockIssueStatus[];
  to: StockIssueStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  done: string;
};

export const STOCK_ISSUE_TRANSITIONS: Record<StockIssueAction, StockIssueTransition> = {
  submit: {
    label: "Ajukan",
    permission: "STOCK_ISSUE_SUBMIT",
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan BSTB Issue",
    body:
      "Barang terkunci di gudang sampai Unit menerimanya, dan dokumen lain tidak bisa mengambilnya. " +
      "Stok dan journal belum bergerak. BSTB Issue yang sudah diajukan tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Ajukan",
    done: "BSTB Issue diajukan",
  },
  post: {
    label: "Terima",
    permission: "STOCK_ISSUE_POST",
    from: ["Submitted"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Terima BSTB Issue",
    body:
      "Barang dicatat keluar dari gudang pada Tanggal dan masuk Persiapan di Unit, per lot " +
      "dengan nomor yang sama, senilai harga pokoknya. Nilainya dipindahkan dengan journal di bawah ini. " +
      "BSTB Issue yang sudah diterima tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Terima",
    done: "BSTB Issue diterima",
  },
  cancel: {
    label: "Batalkan",
    permission: "STOCK_ISSUE_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan BSTB Issue",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada stok yang bergerak dan tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa BSTB Issue ini dibatalkan…",
    done: "BSTB Issue dibatalkan",
  },
};

export function stockIssueTransitionAllowed(action: StockIssueAction, status: StockIssueStatus): boolean {
  return STOCK_ISSUE_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited. */
export function stockIssueIsEditable(status: StockIssueStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with BSTB Issues — presentation only. */
export type StockIssueAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  post: boolean;
  cancel: boolean;
};

export function stockIssueAbilities(permissions: Iterable<string>): StockIssueAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("STOCK_ISSUE_CREATE"),
    edit: held.has("STOCK_ISSUE_EDIT"),
    submit: held.has("STOCK_ISSUE_SUBMIT"),
    post: held.has("STOCK_ISSUE_POST"),
    cancel: held.has("STOCK_ISSUE_CANCEL"),
  };
}

/** The transitions this user may run on an issue in this status. */
export function availableStockIssueActions(status: StockIssueStatus, can: StockIssueAbilities): StockIssueAction[] {
  return STOCK_ISSUE_ACTIONS.filter((a) => stockIssueTransitionAllowed(a, status) && can[a]);
}

export const STOCK_ISSUE_STATUS_TEXT: Record<StockIssueStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  Posted: "Diterima",
  Cancelled: "Dibatalkan",
};

export const STOCK_ISSUE_STATUS_BADGE: Record<StockIssueStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
