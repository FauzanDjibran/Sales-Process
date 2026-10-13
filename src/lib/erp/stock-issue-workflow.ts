/**
 * The Stock Issue's lifecycle, written once and read by both sides (P158).
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting is the moment the goods leave the warehouse: each lot is issued
 * through the stock books and, for production, enters the production ledger at
 * the workstation, with one journal Dr WIP / Cr Persediaan. A posted issue is
 * final. Batalkan is for a Draft only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type StockIssueStatus = "Draft" | "Posted" | "Cancelled";

export type StockIssueAction = "post" | "cancel";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const STOCK_ISSUE_ACTIONS: StockIssueAction[] = ["cancel", "post"];

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
  post: {
    label: "Posting",
    permission: "STOCK_ISSUE_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "box",
    tone: "primary",
    title: "Posting Stock Issue",
    body:
      "Barang dicatat keluar dari gudang pada Tanggal dan masuk produksi di Workstation, per lot " +
      "dengan nomor yang sama, senilai harga pokoknya. Nilainya dipindahkan dengan journal di bawah ini. " +
      "Stock Issue yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Stock Issue diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "STOCK_ISSUE_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Stock Issue",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada stok yang bergerak dan tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Stock Issue ini dibatalkan…",
    done: "Stock Issue dibatalkan",
  },
};

export function stockIssueTransitionAllowed(action: StockIssueAction, status: StockIssueStatus): boolean {
  return STOCK_ISSUE_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; posting makes it final. */
export function stockIssueIsEditable(status: StockIssueStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with Stock Issues — presentation only. */
export type StockIssueAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function stockIssueAbilities(permissions: Iterable<string>): StockIssueAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("STOCK_ISSUE_CREATE"),
    edit: held.has("STOCK_ISSUE_EDIT"),
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
  Posted: "Diposting",
  Cancelled: "Dibatalkan",
};

export const STOCK_ISSUE_STATUS_BADGE: Record<StockIssueStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
