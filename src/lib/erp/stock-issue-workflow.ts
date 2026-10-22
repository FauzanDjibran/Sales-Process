/**
 * The Stock Issue's lifecycle — the Logistik BSTB (P158; Walet step 3, M113),
 * written once and read by both sides.
 *
 *   Draft ──post──> Posted (Dikirim) ──receive──> Received
 *     │                    │
 *     │                    └──reject──> Rejected
 *     └──cancel──> Cancelled
 *
 * Posting is the moment the goods leave the warehouse: each lot is issued
 * through the stock books and, for production, enters the production ledger
 * **in transit** to the workstation, with one journal Dr WIP / Cr Persediaan.
 * The workstation then **receives it whole** (Terima: into its own bucket, no
 * journal) or **rejects it whole** (Tolak, with a reason: back to the same
 * warehouse, location and lot at the value it left at, Dr Persediaan / Cr
 * WIP). A station works only goods it has received. Batalkan is for a Draft
 * only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type StockIssueStatus = "Draft" | "Posted" | "Received" | "Rejected" | "Cancelled";

export type StockIssueAction = "post" | "cancel" | "receive" | "reject";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const STOCK_ISSUE_ACTIONS: StockIssueAction[] = ["cancel", "reject", "post", "receive"];

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
  /** The step asks for the day it happens (Terima, Tolak). */
  dated?: boolean;
  /** The step writes a journal, shown by a dry run in its confirmation (P103). */
  journal?: boolean;
  done: string;
};

export const STOCK_ISSUE_TRANSITIONS: Record<StockIssueAction, StockIssueTransition> = {
  post: {
    label: "Posting",
    permission: "STOCK_ISSUE_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "truck",
    tone: "primary",
    title: "Posting Stock Issue",
    body:
      "Barang dicatat keluar dari gudang pada Tanggal dan dikirim ke Workstation, per lot dengan nomor " +
      "yang sama, senilai harga pokoknya; selama belum diterima, barang dalam perjalanan. Nilainya " +
      "dipindahkan dengan journal di bawah ini. Stock Issue yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    journal: true,
    done: "Stock Issue diposting — barang dalam perjalanan",
  },
  receive: {
    label: "Terima",
    permission: "STOCK_ISSUE_RECEIVE",
    from: ["Posted"],
    to: "Received",
    icon: "check",
    tone: "primary",
    title: "Terima di Workstation",
    body:
      "Workstation menerima seluruh barang kiriman ini, per lot, pada tanggal di bawah; sejak itu barang " +
      "dapat dikerjakan. Nilainya tidak berubah dan tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Terima",
    dated: true,
    done: "Stock Issue diterima",
  },
  reject: {
    label: "Tolak",
    permission: "STOCK_ISSUE_RECEIVE",
    from: ["Posted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak di Workstation",
    body:
      "Workstation menolak seluruh barang kiriman ini: barang kembali ke gudang, lokasi dan lot asalnya, " +
      "senilai saat keluar, dengan journal di bawah ini. Status ini final.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa kiriman ini ditolak…",
    dated: true,
    journal: true,
    done: "Stock Issue ditolak — barang kembali ke gudang",
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

/** The goods have left stock: sent, received or sent back. */
export function stockIssueIsPosted(status: StockIssueStatus): boolean {
  return status === "Posted" || status === "Received" || status === "Rejected";
}

/** What the signed-in user may do with Stock Issues — presentation only. */
export type StockIssueAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
  receive: boolean;
  reject: boolean;
};

export function stockIssueAbilities(permissions: Iterable<string>): StockIssueAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("STOCK_ISSUE_CREATE"),
    edit: held.has("STOCK_ISSUE_EDIT"),
    post: held.has("STOCK_ISSUE_POST"),
    cancel: held.has("STOCK_ISSUE_CANCEL"),
    receive: held.has("STOCK_ISSUE_RECEIVE"),
    reject: held.has("STOCK_ISSUE_RECEIVE"),
  };
}

/** The transitions this user may run on an issue in this status. */
export function availableStockIssueActions(status: StockIssueStatus, can: StockIssueAbilities): StockIssueAction[] {
  return STOCK_ISSUE_ACTIONS.filter((a) => stockIssueTransitionAllowed(a, status) && can[a]);
}

export const STOCK_ISSUE_STATUS_TEXT: Record<StockIssueStatus, string> = {
  Draft: "Draft",
  Posted: "Dikirim",
  Received: "Diterima",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
};

export const STOCK_ISSUE_STATUS_BADGE: Record<StockIssueStatus, string> = {
  Draft: "s-warn",
  Posted: "s-info",
  Received: "s-ok",
  Rejected: "s-bad",
  Cancelled: "s-mute",
};
