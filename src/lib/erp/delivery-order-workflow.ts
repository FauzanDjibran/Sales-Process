/**
 * The Delivery Order's lifecycle, written once and read by both sides (P93).
 *
 *   Draft ──issue──> Issued ──close──> Closed
 *     │
 *     └──cancel──> Cancelled
 *
 * Terbitkan sends the instruction to the warehouse and locks it; there is no
 * approval step. Batalkan is for a Draft only: once issued, the warehouse may
 * already be picking, so an issued order is closed with a reason instead. A
 * posted Delivery Note closes an order itself once every line has left (U14).
 * A Delivery Order posts nothing at any step.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type DeliveryOrderStatus = "Draft" | "Issued" | "Closed" | "Cancelled";

export type DeliveryOrderAction = "issue" | "cancel" | "close";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const DELIVERY_ORDER_ACTIONS: DeliveryOrderAction[] = ["cancel", "close", "issue"];

export type DeliveryOrderTransition = {
  label: string;
  permission: PermissionCode;
  from: DeliveryOrderStatus[];
  to: DeliveryOrderStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  done: string;
};

export const DELIVERY_ORDER_TRANSITIONS: Record<DeliveryOrderAction, DeliveryOrderTransition> = {
  issue: {
    label: "Terbitkan",
    permission: "DELIVERY_ORDER_ISSUE",
    from: ["Draft"],
    to: "Issued",
    icon: "send",
    tone: "primary",
    title: "Terbitkan Delivery Order",
    body:
      "Delivery Order dikunci dan dikirim ke gudang sebagai perintah kirim: tanggal, gudang, " +
      "alamat dan jumlah per barang tidak dapat diubah lagi. Jumlahnya tetap memakai sisa " +
      "Sales Order. Tidak ada journal dan tidak ada pergerakan stok yang dibuat.",
    confirmLabel: "Ya, Terbitkan",
    done: "Delivery Order diterbitkan",
  },
  cancel: {
    label: "Batalkan",
    permission: "DELIVERY_ORDER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Delivery Order",
    body:
      "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi; jumlahnya kembali menjadi " +
      "sisa Sales Order. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Delivery Order ini dibatalkan…",
    done: "Delivery Order dibatalkan",
  },
  close: {
    label: "Tutup",
    permission: "DELIVERY_ORDER_CLOSE",
    from: ["Issued"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Delivery Order",
    body:
      "Delivery Order ditutup dan tidak dapat dipakai lagi. Hanya jumlah yang sudah " +
      "terkirim yang tetap tercatat pada Sales Order; sisanya kembali menjadi sisa " +
      "Sales Order. Status ini final.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa Delivery Order ini ditutup…",
    done: "Delivery Order ditutup",
  },
};

export function deliveryOrderTransitionAllowed(action: DeliveryOrderAction, status: DeliveryOrderStatus): boolean {
  return DELIVERY_ORDER_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; issuing locks the order. */
export function deliveryOrderIsEditable(status: DeliveryOrderStatus): boolean {
  return status === "Draft";
}

/**
 * The statuses whose quantity is taken from the Sales Order. A cancelled order
 * gives its quantity back; a closed one holds only what was delivered (U14).
 */
export const DELIVERY_ORDER_HOLDS_QTY: DeliveryOrderStatus[] = ["Draft", "Issued", "Closed"];

/** The statuses that keep a Sales Order from being closed (P93). */
export const DELIVERY_ORDER_LIVE: DeliveryOrderStatus[] = ["Draft", "Issued"];

/** What the signed-in user may do with Delivery Orders — presentation only. */
export type DeliveryOrderAbilities = {
  create: boolean;
  edit: boolean;
  issue: boolean;
  cancel: boolean;
  close: boolean;
};

export function deliveryOrderAbilities(permissions: Iterable<string>): DeliveryOrderAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("DELIVERY_ORDER_CREATE"),
    edit: held.has("DELIVERY_ORDER_EDIT"),
    issue: held.has("DELIVERY_ORDER_ISSUE"),
    cancel: held.has("DELIVERY_ORDER_CANCEL"),
    close: held.has("DELIVERY_ORDER_CLOSE"),
  };
}

/** The transitions this user may run on an order in this status. */
export function availableDeliveryOrderActions(status: DeliveryOrderStatus, can: DeliveryOrderAbilities): DeliveryOrderAction[] {
  return DELIVERY_ORDER_ACTIONS.filter((a) => deliveryOrderTransitionAllowed(a, status) && can[a]);
}

export const DELIVERY_ORDER_STATUS_TEXT: Record<DeliveryOrderStatus, string> = {
  Draft: "Draft",
  Issued: "Diterbitkan",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
};

export const DELIVERY_ORDER_STATUS_BADGE: Record<DeliveryOrderStatus, string> = {
  Draft: "s-warn",
  Issued: "s-ok",
  Closed: "s-mute",
  Cancelled: "s-mute",
};

/** The final steps that carry a reason, and how the form introduces it. */
export const DELIVERY_ORDER_REASON_TEXT: Partial<Record<DeliveryOrderStatus, string>> = {
  Cancelled: "Dibatalkan",
  Closed: "Ditutup",
};
