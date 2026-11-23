/**
 * The Stock Issue's lifecycle, written once and read by both sides (R4, P317).
 *
 *   Draft ──submit (Kirim)──> InTransit (Dalam Perjalanan) ──> Received (Diterima)
 *     │
 *     └──cancel──> Cancelled
 *
 * Kirim is the moment the goods leave the warehouse, journalled at a value that
 * never changes again. Diterima is not a step here: it is what Produksi says
 * when the Unit takes the goods in. Batalkan is for a Draft only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type StockIssueStatus = "Draft" | "InTransit" | "Received" | "Cancelled";

export type StockIssueAction = "submit" | "cancel";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const STOCK_ISSUE_ACTIONS: StockIssueAction[] = ["cancel", "submit"];

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
    label: "Kirim",
    permission: "STOCK_ISSUE_SUBMIT",
    from: ["Draft"],
    to: "InTransit",
    icon: "send",
    tone: "primary",
    title: "Kirim Stock Issue",
    body:
      "Barang keluar dari gudang pada Tanggal, per lot, senilai harga pokoknya, dengan journal di bawah ini; " +
      "berstatus Dalam Perjalanan sampai Unit menerimanya. Stock Issue yang sudah dikirim tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Kirim",
    done: "Stock Issue dikirim",
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

/** Only a Draft can be edited. */
export function stockIssueIsEditable(status: StockIssueStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with Stock Issues — presentation only. */
export type StockIssueAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  cancel: boolean;
};

export function stockIssueAbilities(permissions: Iterable<string>): StockIssueAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("STOCK_ISSUE_CREATE"),
    edit: held.has("STOCK_ISSUE_EDIT"),
    submit: held.has("STOCK_ISSUE_SUBMIT"),
    cancel: held.has("STOCK_ISSUE_CANCEL"),
  };
}

/** The transitions this user may run on an issue in this status. */
export function availableStockIssueActions(status: StockIssueStatus, can: StockIssueAbilities): StockIssueAction[] {
  return STOCK_ISSUE_ACTIONS.filter((a) => stockIssueTransitionAllowed(a, status) && can[a]);
}

export const STOCK_ISSUE_STATUS_TEXT: Record<StockIssueStatus, string> = {
  Draft: "Draft",
  InTransit: "Dalam Perjalanan",
  Received: "Diterima",
  Cancelled: "Dibatalkan",
};

export const STOCK_ISSUE_STATUS_BADGE: Record<StockIssueStatus, string> = {
  Draft: "s-warn",
  InTransit: "s-info",
  Received: "s-ok",
  Cancelled: "s-mute",
};
