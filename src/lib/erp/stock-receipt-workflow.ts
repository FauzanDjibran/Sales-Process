/**
 * The Stock Receipt's lifecycle (P339), written once and read by every screen.
 *
 *   Draft ──receive (Terima)──> Received (Diterima): a purpose with a source
 *     │
 *     ├──receive (Posting)──> Posted (Diposting): Penerimaan Lain-lain
 *     │
 *     └──cancel──> Cancelled: gives its source back
 *
 * Terima / Posting puts the goods in stock and writes the journal, at the value
 * the purpose says (SR-7). Batalkan is for a Draft only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";
import { STOCK_RECEIPT_PURPOSES, stockReceiptPurposeOf } from "./stock-receipt-purposes";

export type StockReceiptStatus = "Draft" | "Received" | "Posted" | "Cancelled";
export type StockReceiptAction = "receive" | "cancel";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const STOCK_RECEIPT_ACTIONS: StockReceiptAction[] = ["cancel", "receive"];

export type StockReceiptTransition = {
  label: string;
  permission: PermissionCode;
  from: StockReceiptStatus[];
  to: StockReceiptStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const STOCK_RECEIPT_TRANSITIONS: Record<StockReceiptAction, StockReceiptTransition> = {
  receive: {
    label: "Terima",
    permission: "STOCK_RECEIPT_RECEIVE",
    from: ["Draft"],
    to: "Received",
    icon: "check",
    tone: "primary",
    title: "Terima Stock Receipt",
    body:
      "Barang masuk gudang pada Tanggal Terima, per No. Stok, di lokasi dan status yang dipilih, senilai yang dibawa sumbernya, dengan journal di bawah ini. " +
      "Stock Receipt yang sudah diterima tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Terima",
    done: "Barang diterima di gudang",
  },
  cancel: {
    label: "Batalkan",
    permission: "STOCK_RECEIPT_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Stock Receipt",
    body: "Draft ditandai Dibatalkan dan sumbernya kembali menunggu diterima. Tidak ada stok yang bergerak dan tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Stock Receipt ini dibatalkan…",
    done: "Stock Receipt dibatalkan",
  },
};

/** The steps of a receipt with this purpose: without a source, Terima is Posting. */
export function stockReceiptTransitions(purpose: string): Record<StockReceiptAction, StockReceiptTransition> {
  if (STOCK_RECEIPT_PURPOSES[stockReceiptPurposeOf(purpose)].source) return STOCK_RECEIPT_TRANSITIONS;
  return {
    ...STOCK_RECEIPT_TRANSITIONS,
    receive: {
      ...STOCK_RECEIPT_TRANSITIONS.receive,
      label: "Posting",
      to: "Posted",
      title: "Posting Stock Receipt",
      body:
        "Barang masuk gudang pada Tanggal Terima, per No. Stok, senilai yang diketik, dengan journal di bawah ini. " +
        "Stock Receipt yang sudah diposting tidak dapat diubah atau dibatalkan.",
      confirmLabel: "Ya, Posting",
      done: "Stock Receipt diposting",
    },
  };
}

export const stockReceiptIsEditable = (status: StockReceiptStatus) => status === "Draft";

export type StockReceiptAbilities = { create: boolean; edit: boolean; receive: boolean; cancel: boolean };

export function stockReceiptAbilities(permissions: Iterable<string>): StockReceiptAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("STOCK_RECEIPT_CREATE"),
    edit: held.has("STOCK_RECEIPT_EDIT"),
    receive: held.has("STOCK_RECEIPT_RECEIVE"),
    cancel: held.has("STOCK_RECEIPT_CANCEL"),
  };
}

export function availableStockReceiptActions(status: StockReceiptStatus, can: StockReceiptAbilities): StockReceiptAction[] {
  return STOCK_RECEIPT_ACTIONS.filter((a) => STOCK_RECEIPT_TRANSITIONS[a].from.includes(status) && can[a]);
}

export const STOCK_RECEIPT_STATUS_TEXT: Record<StockReceiptStatus, string> = {
  Draft: "Draft",
  Received: "Diterima",
  Posted: "Diposting",
  Cancelled: "Dibatalkan",
};
export const STOCK_RECEIPT_STATUS_BADGE: Record<StockReceiptStatus, string> = {
  Draft: "s-warn",
  Received: "s-ok",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
