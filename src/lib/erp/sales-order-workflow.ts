/**
 * The Sales Order's lifecycle, written once and read by both sides (P63).
 *
 *   Draft ──submit──> Submitted ──approve──> Open ──close──> Closed
 *     │                   │
 *     └──cancel──> Cancelled   └──reject──> Rejected
 *
 * Cancelled, Rejected and Closed are final. A submitted order is not taken
 * back: it is approved or rejected, and a rejected one is copied with Salin.
 * Closing is by hand for now, even with quantity still to deliver; the Surat
 * Jalan will close an order itself once everything is delivered. A Sales
 * Order posts nothing at any step.
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

export type SalesOrderStatus = "Draft" | "Submitted" | "Open" | "Closed" | "Cancelled" | "Rejected";

export type SalesOrderAction = "submit" | "approve" | "reject" | "cancel" | "close";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const SALES_ORDER_ACTIONS: SalesOrderAction[] = ["cancel", "reject", "close", "submit", "approve"];

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
      "Pesanan dikunci dan menunggu persetujuan: customer, alamat, Kena PPN, " +
      "mode harga dan seluruh baris tidak dapat diubah lagi, dan tidak dapat " +
      "ditarik kembali. Tidak ada journal atau dokumen pajak yang dibuat.",
    confirmLabel: "Ya, Ajukan",
    done: "Sales Order diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "SALES_ORDER_APPROVE",
    from: ["Submitted"],
    to: "Open",
    icon: "check",
    tone: "primary",
    title: "Setujui Sales Order",
    body:
      "Pesanan menjadi Open: siap ditagihkan uang muka dan, nanti, dikirim " +
      "dengan Surat Jalan. Tidak ada journal atau dokumen pajak yang dibuat.",
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
      "Pesanan ditandai Ditolak dan tidak dapat dipakai lagi. Status ini " +
      "final; untuk mengajukan ulang, Salin pesanan ini menjadi Draft baru.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa pesanan ini ditolak…",
    done: "Sales Order ditolak",
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
      "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Status ini " +
      "final. Nomornya tetap tersimpan sebagai jejak.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa pesanan ini dibatalkan…",
    done: "Sales Order dibatalkan",
  },
  close: {
    label: "Tutup Pesanan",
    permission: "SALES_ORDER_CLOSE",
    from: ["Open"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Sales Order",
    body:
      "Pesanan ditutup walaupun belum seluruhnya dikirim: tidak ada Surat " +
      "Jalan atau tagihan uang muka baru yang dapat dibuat darinya. Tagihan " +
      "uang muka yang sudah terbit tidak berubah. Status ini final.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa pesanan ini ditutup…",
    done: "Sales Order ditutup",
  },
};

export function salesOrderTransitionAllowed(
  action: SalesOrderAction,
  status: SalesOrderStatus
): boolean {
  return SALES_ORDER_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; submitting locks the order. */
export function salesOrderIsEditable(status: SalesOrderStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with Sales Orders — presentation only. */
export type SalesOrderAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
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
    cancel: held.has("SALES_ORDER_CANCEL"),
    close: held.has("SALES_ORDER_CLOSE"),
  };
}

/** The transitions this user may run on an order in this status. */
export function availableSalesOrderActions(
  status: SalesOrderStatus,
  can: SalesOrderAbilities
): SalesOrderAction[] {
  return SALES_ORDER_ACTIONS.filter(
    (a) => salesOrderTransitionAllowed(a, status) && can[a]
  );
}

export const SALES_ORDER_STATUS_TEXT: Record<SalesOrderStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  Open: "Open",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
};

export const SALES_ORDER_STATUS_BADGE: Record<SalesOrderStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
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
