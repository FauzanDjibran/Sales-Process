/**
 * The Purchase Request's lifecycle, written once and read by both sides
 * (P123, Purchasing-Concept.md B8).
 *
 *   Draft ──submit──> Open ──close──> Closed
 *     │
 *     └──cancel──> Cancelled
 *
 * No approval (the user: only the Purchase Order is approved). Ajukan locks
 * the request and makes it Open, so a Purchase Order may take from it. Tutup
 * closes it by hand with a reason; it also closes itself once every line is
 * fully ordered. A Purchase Request posts nothing at any step.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type PurchaseRequestStatus = "Draft" | "Open" | "Closed" | "Cancelled";

export type PurchaseRequestAction = "submit" | "cancel" | "close";

export const PURCHASE_REQUEST_ACTIONS: PurchaseRequestAction[] = ["cancel", "close", "submit"];

/** Barang or Jasa: one table, two menus, one kind per request (B6). */
export type PurchaseRequestKind = "goods" | "service";

export const PURCHASE_REQUEST_KINDS: Record<PurchaseRequestKind, { itemType: "Barang" | "Jasa"; name: string; path: string }> = {
  goods: { itemType: "Barang", name: "Purchase Request Barang", path: "/purchasing/request/goods" },
  service: { itemType: "Jasa", name: "Purchase Request Jasa", path: "/purchasing/request/service" },
};

export function kindOfItemType(itemType: "Barang" | "Jasa"): PurchaseRequestKind {
  return itemType === "Barang" ? "goods" : "service";
}

export type PurchaseRequestTransition = {
  label: string;
  permission: PermissionCode;
  from: PurchaseRequestStatus[];
  to: PurchaseRequestStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const PURCHASE_REQUEST_TRANSITIONS: Record<PurchaseRequestAction, PurchaseRequestTransition> = {
  submit: {
    label: "Ajukan",
    permission: "PURCHASE_REQUEST_SUBMIT",
    from: ["Draft"],
    to: "Open",
    icon: "send",
    tone: "primary",
    title: "Ajukan Purchase Request",
    body:
      "Purchase Request dikunci dan menjadi Open: barang, jumlah dan tanggal " +
      "dibutuhkan tidak dapat diubah lagi, dan Purchase Order dapat dibuat " +
      "darinya. Tidak ada journal yang dibuat.",
    confirmLabel: "Ya, Ajukan",
    done: "Purchase Request diajukan",
  },
  cancel: {
    label: "Batalkan",
    permission: "PURCHASE_REQUEST_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Purchase Request",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Purchase Request ini dibatalkan…",
    done: "Purchase Request dibatalkan",
  },
  close: {
    label: "Tutup",
    permission: "PURCHASE_REQUEST_CLOSE",
    from: ["Open"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Purchase Request",
    body:
      "Purchase Request ditutup: sisa yang belum dipesan tidak lagi dapat " +
      "diambil Purchase Order. Yang sudah dipesan tetap tercatat. Status ini final.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa Purchase Request ini ditutup…",
    done: "Purchase Request ditutup",
  },
};

export function purchaseRequestTransitionAllowed(action: PurchaseRequestAction, status: PurchaseRequestStatus): boolean {
  return PURCHASE_REQUEST_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; Ajukan locks the request. */
export function purchaseRequestIsEditable(status: PurchaseRequestStatus): boolean {
  return status === "Draft";
}

export type PurchaseRequestAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  cancel: boolean;
  close: boolean;
};

export function purchaseRequestAbilities(permissions: Iterable<string>): PurchaseRequestAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PURCHASE_REQUEST_CREATE"),
    edit: held.has("PURCHASE_REQUEST_EDIT"),
    submit: held.has("PURCHASE_REQUEST_SUBMIT"),
    cancel: held.has("PURCHASE_REQUEST_CANCEL"),
    close: held.has("PURCHASE_REQUEST_CLOSE"),
  };
}

export function availablePurchaseRequestActions(status: PurchaseRequestStatus, can: PurchaseRequestAbilities): PurchaseRequestAction[] {
  return PURCHASE_REQUEST_ACTIONS.filter((a) => purchaseRequestTransitionAllowed(a, status) && can[a]);
}

export const PURCHASE_REQUEST_STATUS_TEXT: Record<PurchaseRequestStatus, string> = {
  Draft: "Draft",
  Open: "Open",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
};

export const PURCHASE_REQUEST_STATUS_BADGE: Record<PurchaseRequestStatus, string> = {
  Draft: "s-warn",
  Open: "s-ok",
  Closed: "s-mute",
  Cancelled: "s-mute",
};

export const PURCHASE_REQUEST_REASON_TEXT: Partial<Record<PurchaseRequestStatus, string>> = {
  Cancelled: "Dibatalkan",
  Closed: "Ditutup",
};
