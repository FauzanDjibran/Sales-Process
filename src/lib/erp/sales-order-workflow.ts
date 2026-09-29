/**
 * The Sales Order's lifecycle, written once and read by both sides (P50).
 *
 *   Draft ──confirm──> Confirmed ──cancel──> Cancelled
 *     └──────────────cancel──────────────────┘
 *
 * No credit limit, so no Menunggu Persetujuan. Selesai and Tutup Pesanan join
 * when the Surat Jalan does. A Sales Order posts nothing at any step.
 *
 * Every transition names the status it may start from, the status it produces
 * and the one permission it needs. The header buttons read this table to decide
 * what to offer; the Server Action reads the same table to decide what to
 * allow — the shape `journal-workflow.ts` set.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type SalesOrderStatus = "Draft" | "Confirmed" | "Cancelled";

export type SalesOrderAction = "confirm" | "cancel";

export type SalesOrderTransition = {
  label: string;
  permission: PermissionCode;
  from: SalesOrderStatus[];
  to: SalesOrderStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** Whether the step asks for a reason, which is stored and shown. */
  needsReason?: boolean;
  done: string;
};

export const SALES_ORDER_TRANSITIONS: Record<SalesOrderAction, SalesOrderTransition> = {
  confirm: {
    label: "Konfirmasi",
    permission: "SALES_ORDER_CONFIRM",
    from: ["Draft"],
    to: "Confirmed",
    icon: "check",
    tone: "primary",
    title: "Konfirmasi Sales Order",
    body:
      "Pesanan dikunci: customer, alamat, mode harga, Kena PPN dan seluruh " +
      "baris tidak dapat diubah lagi. Tidak ada journal atau dokumen pajak " +
      "yang dibuat — Sales Order tidak memposting apa pun.",
    confirmLabel: "Ya, Konfirmasi",
    done: "Sales Order dikonfirmasi",
  },
  cancel: {
    label: "Batalkan",
    permission: "SALES_ORDER_CANCEL",
    from: ["Draft", "Confirmed"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Konfirmasi Batalkan Sales Order",
    body:
      "Sales Order ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada " +
      "saldo yang terpengaruh karena Sales Order tidak pernah memposting. " +
      "Nomornya tetap tersimpan sebagai jejak.",
    confirmLabel: "Ya, Batalkan",
    needsReason: true,
    done: "Sales Order dibatalkan",
  },
};

export function salesOrderTransitionAllowed(
  action: SalesOrderAction,
  status: SalesOrderStatus
): boolean {
  return SALES_ORDER_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; confirming locks the order. */
export function salesOrderIsEditable(status: SalesOrderStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with Sales Orders — presentation only. */
export type SalesOrderAbilities = {
  create: boolean;
  edit: boolean;
  confirm: boolean;
  cancel: boolean;
};

export function salesOrderAbilities(permissions: Iterable<string>): SalesOrderAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("SALES_ORDER_CREATE"),
    edit: held.has("SALES_ORDER_EDIT"),
    confirm: held.has("SALES_ORDER_CONFIRM"),
    cancel: held.has("SALES_ORDER_CANCEL"),
  };
}

/** The transitions this user may run on an order in this status. */
export function availableSalesOrderActions(
  status: SalesOrderStatus,
  can: SalesOrderAbilities
): SalesOrderAction[] {
  return (["confirm", "cancel"] as SalesOrderAction[]).filter(
    (a) => salesOrderTransitionAllowed(a, status) && can[a]
  );
}

export const SALES_ORDER_STATUS_TEXT: Record<SalesOrderStatus, string> = {
  Draft: "Draft",
  Confirmed: "Dikonfirmasi",
  Cancelled: "Dibatalkan",
};

export const SALES_ORDER_STATUS_BADGE: Record<SalesOrderStatus, string> = {
  Draft: "s-warn",
  Confirmed: "s-ok",
  Cancelled: "s-mute",
};
