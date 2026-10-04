/**
 * The Faktur Penjualan's lifecycle, written once and read by both sides
 * (`Sales-Process-Concept.md` §9.5).
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting is where Piutang, revenue and output PPN are born and the order's
 * Uang Muka picked are used. A posted Faktur is final — a correction is a Nota
 * Retur or a Faktur Pengganti, later. Batalkan is for a Draft only, with a
 * reason, and frees its Delivery Note lines to be billed again.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type InvoiceStatus = "Draft" | "Posted" | "Cancelled";

export type InvoiceAction = "post" | "cancel";

export const INVOICE_ACTIONS: InvoiceAction[] = ["cancel", "post"];

export type InvoiceTransition = {
  label: string;
  permission: PermissionCode;
  from: InvoiceStatus[];
  to: InvoiceStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const INVOICE_TRANSITIONS: Record<InvoiceAction, InvoiceTransition> = {
  post: {
    label: "Posting",
    permission: "SALES_INVOICE_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Posting Faktur Penjualan",
    body:
      "Piutang, penjualan dan PPN Keluaran diakui dengan journal di bawah ini pada Tanggal " +
      "Faktur, uang muka yang dipilih dipakai, dan piutangnya menjadi invoice yang dapat " +
      "dilunasi. Faktur yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Faktur Penjualan diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "SALES_INVOICE_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Faktur Penjualan",
    body:
      "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi; baris Delivery Note-nya dapat " +
      "ditagih lagi dan uang mukanya tidak lagi dicadangkan. Tidak ada journal yang dibuat. " +
      "Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Faktur ini dibatalkan…",
    done: "Faktur Penjualan dibatalkan",
  },
};

export function invoiceTransitionAllowed(action: InvoiceAction, status: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[action].from.includes(status);
}

export function invoiceIsEditable(status: InvoiceStatus): boolean {
  return status === "Draft";
}

/** The statuses that bill a Delivery Note line and reserve an Uang Muka: a Draft holds, a posted Faktur has billed. */
export const INVOICE_HOLDS: InvoiceStatus[] = ["Draft", "Posted"];

export type InvoiceAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function invoiceAbilities(permissions: Iterable<string>): InvoiceAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("SALES_INVOICE_CREATE"),
    edit: held.has("SALES_INVOICE_EDIT"),
    post: held.has("SALES_INVOICE_POST"),
    cancel: held.has("SALES_INVOICE_CANCEL"),
  };
}

export function availableInvoiceActions(status: InvoiceStatus, can: InvoiceAbilities): InvoiceAction[] {
  return INVOICE_ACTIONS.filter((a) => invoiceTransitionAllowed(a, status) && can[a]);
}

export const INVOICE_STATUS_TEXT: Record<InvoiceStatus, string> = {
  Draft: "Draft",
  Posted: "Diposting",
  Cancelled: "Dibatalkan",
};

export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
