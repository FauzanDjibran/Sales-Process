/**
 * The Sales Order's lifecycle, written once and read by both sides (P79).
 *
 *   Draft ──submit──> Submitted ──approve──> Pra-SO ──confirm──> Open ──close──> Closed
 *     │                   │                     │                          ▲
 *     └──cancel──> Cancelled   └──reject──> Rejected   └──────close───────────┘
 *
 * Ajukan locks the order. Setujui is the approval and makes it **Pra-SO**: it
 * may be used to buy material, not yet to produce. Konfirmasi moves it along to
 * **Open**, which may also be produced. Neither purchasing nor production
 * exists yet, so the two states differ only in name for now.
 *
 * Batalkan is for a Draft and Tolak for a submitted order — once approved,
 * purchasing may already lean on it, so it is closed rather than cancelled.
 * Closing by hand takes a reason; a posted Delivery Note closes an Open
 * order itself once every line is delivered (U14). A Sales Order posts
 * nothing at any step.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type SalesOrderStatus = "Draft" | "Submitted" | "PreSO" | "Open" | "Closed" | "Cancelled" | "Rejected";

export type SalesOrderAction = "submit" | "approve" | "reject" | "confirm" | "cancel" | "close";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const SALES_ORDER_ACTIONS: SalesOrderAction[] = ["cancel", "reject", "close", "submit", "approve", "confirm"];

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
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  done: string;
};

export const SALES_ORDER_TRANSITIONS: Record<SalesOrderAction, SalesOrderTransition> = {
  submit: {
    label: "Ajukan",
    permission: "SALES_ORDER_SUBMIT",
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Sales Order",
    body:
      "Sales Order dikunci dan menunggu persetujuan: tanggal kirim, alamat dan " +
      "jumlah per barang tidak dapat diubah lagi. Jumlahnya tetap memakai sisa " +
      "Customer Order. Tidak ada journal yang dibuat.",
    confirmLabel: "Ya, Ajukan",
    done: "Sales Order diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "SALES_ORDER_APPROVE",
    from: ["Submitted"],
    to: "PreSO",
    icon: "check",
    tone: "primary",
    title: "Setujui Sales Order",
    body:
      "Sales Order menjadi Pra-SO: dapat dipakai sebagai dasar pembelian bahan, " +
      "tetapi belum untuk produksi. Tidak ada journal yang dibuat.",
    confirmLabel: "Ya, Setujui",
    done: "Sales Order disetujui",
  },
  reject: {
    label: "Tolak",
    permission: "SALES_ORDER_APPROVE",
    from: ["Submitted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak Sales Order",
    body:
      "Sales Order ditandai Ditolak dan tidak dapat dipakai lagi; jumlahnya " +
      "kembali menjadi sisa Customer Order. Status ini final.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa Sales Order ini ditolak…",
    done: "Sales Order ditolak",
  },
  confirm: {
    label: "Konfirmasi",
    permission: "SALES_ORDER_CONFIRM",
    from: ["PreSO"],
    to: "Open",
    icon: "check",
    tone: "primary",
    title: "Konfirmasi Sales Order",
    body:
      "Sales Order menjadi Open: selain untuk pembelian bahan, dapat menjadi " +
      "dasar produksi. Tidak ada journal yang dibuat.",
    confirmLabel: "Ya, Konfirmasi",
    done: "Sales Order dikonfirmasi",
  },
  cancel: {
    label: "Batalkan",
    permission: "SALES_ORDER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Sales Order",
    body:
      "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi; jumlahnya " +
      "kembali menjadi sisa Customer Order. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Sales Order ini dibatalkan…",
    done: "Sales Order dibatalkan",
  },
  close: {
    label: "Tutup",
    permission: "SALES_ORDER_CLOSE",
    from: ["PreSO", "Open"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Sales Order",
    body:
      "Sales Order ditutup dan tidak dapat dipakai lagi. Hanya jumlah yang sudah " +
      "terkirim yang tetap tercatat pada Customer Order; sisanya kembali menjadi " +
      "sisa Customer Order. Status ini final.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa Sales Order ini ditutup…",
    done: "Sales Order ditutup",
  },
};

export function salesOrderTransitionAllowed(action: SalesOrderAction, status: SalesOrderStatus): boolean {
  return SALES_ORDER_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; submitting locks the order. */
export function salesOrderIsEditable(status: SalesOrderStatus): boolean {
  return status === "Draft";
}

/**
 * The statuses whose quantity is taken from the Customer Order. A cancelled or
 * rejected order gives its quantity back; a closed one holds only what was
 * delivered of it (U14).
 */
export const SALES_ORDER_HOLDS_QTY: SalesOrderStatus[] = ["Draft", "Submitted", "PreSO", "Open", "Closed"];

/** The statuses that keep a Customer Order from being closed (P79). */
export const SALES_ORDER_LIVE: SalesOrderStatus[] = ["Draft", "Submitted", "PreSO", "Open"];

/** What the signed-in user may do with Sales Orders — presentation only. */
export type SalesOrderAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  confirm: boolean;
  cancel: boolean;
  close: boolean;
};

export function salesOrderAbilities(permissions: Iterable<string>): SalesOrderAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("SALES_ORDER_CREATE"),
    edit: held.has("SALES_ORDER_EDIT"),
    submit: held.has("SALES_ORDER_SUBMIT"),
    approve: held.has("SALES_ORDER_APPROVE"),
    reject: held.has("SALES_ORDER_APPROVE"),
    confirm: held.has("SALES_ORDER_CONFIRM"),
    cancel: held.has("SALES_ORDER_CANCEL"),
    close: held.has("SALES_ORDER_CLOSE"),
  };
}

/** The transitions this user may run on an order in this status. */
export function availableSalesOrderActions(status: SalesOrderStatus, can: SalesOrderAbilities): SalesOrderAction[] {
  return SALES_ORDER_ACTIONS.filter((a) => salesOrderTransitionAllowed(a, status) && can[a]);
}

export const SALES_ORDER_STATUS_TEXT: Record<SalesOrderStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  PreSO: "Pra-SO",
  Open: "Open",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
};

export const SALES_ORDER_STATUS_BADGE: Record<SalesOrderStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
  PreSO: "s-info",
  Open: "s-ok",
  Closed: "s-mute",
  Cancelled: "s-mute",
  Rejected: "s-bad",
};

/** The final steps that carry a reason, and how the form introduces it. */
export const SALES_ORDER_REASON_TEXT: Partial<Record<SalesOrderStatus, string>> = {
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
  Closed: "Ditutup",
};
