/**
 * The lifecycles of Transfer Kirim and Transfer Terima (P300,
 * `Stock-Transfer-Plan.md` §3.1–§3.2), written once and read by both sides.
 *
 *   Transfer Kirim:  Draft ──send──> InTransit ──(every line received)──> Received
 *                      └──cancel──> Cancelled
 *
 *   Transfer Terima: Draft ──post──> Posted
 *                      └──cancel──> Cancelled
 *
 * No approval (OD-8). Kirim moves the goods from the origin into the Gudang
 * Transit; Terima from the transit into the destination, in parts. Neither
 * writes a journal: the item's pool ends exactly where it started (OD-6). A
 * sent or posted document is final; Batalkan is for a Draft only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

type Transition<S extends string> = {
  label: string;
  permission: PermissionCode;
  from: S[];
  to: S;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  done: string;
};

// ------------------------------------------------------------- Transfer Kirim

export type StockTransferStatus = "Draft" | "InTransit" | "Received" | "Cancelled";
export type StockTransferAction = "send" | "cancel";
export const STOCK_TRANSFER_ACTIONS: StockTransferAction[] = ["cancel", "send"];

export const STOCK_TRANSFER_TRANSITIONS: Record<StockTransferAction, Transition<StockTransferStatus>> = {
  send: {
    label: "Kirim",
    permission: "STOCK_TRANSFER_SEND",
    from: ["Draft"],
    to: "InTransit",
    icon: "send",
    tone: "primary",
    title: "Kirim Transfer Stok",
    body:
      "Stok keluar dari gudang asal per lot dan masuk Gudang Transit dengan lot dan status yang sama, " +
      "sampai gudang tujuan menerimanya lewat Transfer Terima. Tidak ada journal dan harga pokok rata-rata " +
      "tidak berubah. Transfer Kirim yang sudah dikirim tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Kirim",
    done: "Transfer dikirim",
  },
  cancel: {
    label: "Batalkan",
    permission: "STOCK_TRANSFER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Transfer Kirim",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada stok yang bergerak. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Transfer Kirim ini dibatalkan…",
    done: "Transfer Kirim dibatalkan",
  },
};

export const stockTransferTransitionAllowed = (a: StockTransferAction, s: StockTransferStatus) => STOCK_TRANSFER_TRANSITIONS[a].from.includes(s);
export const stockTransferIsEditable = (s: StockTransferStatus) => s === "Draft";

export type StockTransferAbilities = { create: boolean; edit: boolean; send: boolean; cancel: boolean };

export function stockTransferAbilities(permissions: Iterable<string>): StockTransferAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("STOCK_TRANSFER_CREATE"),
    edit: held.has("STOCK_TRANSFER_EDIT"),
    send: held.has("STOCK_TRANSFER_SEND"),
    cancel: held.has("STOCK_TRANSFER_CANCEL"),
  };
}

export function availableStockTransferActions(status: StockTransferStatus, can: StockTransferAbilities): StockTransferAction[] {
  return STOCK_TRANSFER_ACTIONS.filter((a) => stockTransferTransitionAllowed(a, status) && can[a]);
}

export const STOCK_TRANSFER_STATUS_TEXT: Record<StockTransferStatus, string> = {
  Draft: "Draft",
  InTransit: "Dalam Perjalanan",
  Received: "Diterima",
  Cancelled: "Dibatalkan",
};

export const STOCK_TRANSFER_STATUS_BADGE: Record<StockTransferStatus, string> = {
  Draft: "s-warn",
  InTransit: "s-info",
  Received: "s-ok",
  Cancelled: "s-mute",
};

// ------------------------------------------------------------ Transfer Terima

export type StockTransferReceiptStatus = "Draft" | "Posted" | "Cancelled";
export type StockTransferReceiptAction = "post" | "cancel";
export const STOCK_TRANSFER_RECEIPT_ACTIONS: StockTransferReceiptAction[] = ["cancel", "post"];

export const STOCK_TRANSFER_RECEIPT_TRANSITIONS: Record<StockTransferReceiptAction, Transition<StockTransferReceiptStatus>> = {
  post: {
    label: "Terima",
    permission: "STOCK_TRANSFER_RECEIPT_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Terima Transfer Stok",
    body:
      "Stok keluar dari Gudang Transit dan masuk gudang tujuan pada Tanggal Terima, per lot dengan status yang sama, " +
      "ke lokasi yang dipilih. Tidak ada journal dan harga pokok rata-rata tidak berubah. " +
      "Transfer Terima yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Terima",
    done: "Transfer diterima",
  },
  cancel: {
    label: "Batalkan",
    permission: "STOCK_TRANSFER_RECEIPT_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Transfer Terima",
    body: "Draft ditandai Dibatalkan dan sisanya kembali bisa diterima. Tidak ada stok yang bergerak. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Transfer Terima ini dibatalkan…",
    done: "Transfer Terima dibatalkan",
  },
};

export const stockTransferReceiptTransitionAllowed = (a: StockTransferReceiptAction, s: StockTransferReceiptStatus) =>
  STOCK_TRANSFER_RECEIPT_TRANSITIONS[a].from.includes(s);
export const stockTransferReceiptIsEditable = (s: StockTransferReceiptStatus) => s === "Draft";

export type StockTransferReceiptAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function stockTransferReceiptAbilities(permissions: Iterable<string>): StockTransferReceiptAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("STOCK_TRANSFER_RECEIPT_CREATE"),
    edit: held.has("STOCK_TRANSFER_RECEIPT_EDIT"),
    post: held.has("STOCK_TRANSFER_RECEIPT_POST"),
    cancel: held.has("STOCK_TRANSFER_RECEIPT_CANCEL"),
  };
}

export function availableStockTransferReceiptActions(status: StockTransferReceiptStatus, can: StockTransferReceiptAbilities): StockTransferReceiptAction[] {
  return STOCK_TRANSFER_RECEIPT_ACTIONS.filter((a) => stockTransferReceiptTransitionAllowed(a, status) && can[a]);
}

export const STOCK_TRANSFER_RECEIPT_STATUS_TEXT: Record<StockTransferReceiptStatus, string> = {
  Draft: "Draft",
  Posted: "Diterima",
  Cancelled: "Dibatalkan",
};

export const STOCK_TRANSFER_RECEIPT_STATUS_BADGE: Record<StockTransferReceiptStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
