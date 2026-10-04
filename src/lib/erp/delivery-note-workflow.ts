/**
 * The Delivery Note's lifecycle, written once and read by both sides (C28,
 * U11–U14).
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting is the moment the goods leave: it issues them through the inventory
 * module and writes one journal, Dr HPP / Cr Persediaan. A posted note is final
 * — never edited, never cancelled; a return will be its own document. Batalkan
 * is for a Draft only, with a reason, and gives the quantity back to the
 * Delivery Order.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type DeliveryNoteStatus = "Draft" | "Posted" | "Cancelled";

export type DeliveryNoteAction = "post" | "cancel";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const DELIVERY_NOTE_ACTIONS: DeliveryNoteAction[] = ["cancel", "post"];

export type DeliveryNoteTransition = {
  label: string;
  permission: PermissionCode;
  from: DeliveryNoteStatus[];
  to: DeliveryNoteStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  done: string;
};

export const DELIVERY_NOTE_TRANSITIONS: Record<DeliveryNoteAction, DeliveryNoteTransition> = {
  post: {
    label: "Posting",
    permission: "DELIVERY_NOTE_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "truck",
    tone: "primary",
    title: "Posting Delivery Note",
    body:
      "Barang dicatat keluar dari gudang pada Tanggal Kirim dan harga pokoknya diakui " +
      "dengan journal di bawah ini. Piutang belum diakui — itu terjadi saat Invoice " +
      "Penjualan diposting. Delivery Note yang sudah diposting tidak dapat diubah " +
      "atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Delivery Note diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "DELIVERY_NOTE_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Delivery Note",
    body:
      "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi; jumlahnya kembali menjadi " +
      "sisa Delivery Order. Tidak ada journal yang dibuat. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Delivery Note ini dibatalkan…",
    done: "Delivery Note dibatalkan",
  },
};

export function deliveryNoteTransitionAllowed(action: DeliveryNoteAction, status: DeliveryNoteStatus): boolean {
  return DELIVERY_NOTE_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; posting makes it final. */
export function deliveryNoteIsEditable(status: DeliveryNoteStatus): boolean {
  return status === "Draft";
}

/** The statuses whose quantity is taken from the Delivery Order: a Draft reserves it, a posted note has sent it. */
export const DELIVERY_NOTE_HOLDS_QTY: DeliveryNoteStatus[] = ["Draft", "Posted"];

/** What the signed-in user may do with Delivery Notes — presentation only. */
export type DeliveryNoteAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function deliveryNoteAbilities(permissions: Iterable<string>): DeliveryNoteAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("DELIVERY_NOTE_CREATE"),
    edit: held.has("DELIVERY_NOTE_EDIT"),
    post: held.has("DELIVERY_NOTE_POST"),
    cancel: held.has("DELIVERY_NOTE_CANCEL"),
  };
}

/** The transitions this user may run on a note in this status. */
export function availableDeliveryNoteActions(status: DeliveryNoteStatus, can: DeliveryNoteAbilities): DeliveryNoteAction[] {
  return DELIVERY_NOTE_ACTIONS.filter((a) => deliveryNoteTransitionAllowed(a, status) && can[a]);
}

export const DELIVERY_NOTE_STATUS_TEXT: Record<DeliveryNoteStatus, string> = {
  Draft: "Draft",
  Posted: "Diposting",
  Cancelled: "Dibatalkan",
};

export const DELIVERY_NOTE_STATUS_BADGE: Record<DeliveryNoteStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
