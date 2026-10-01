/**
 * The Customer Order's lifecycle, written once and read by both sides (P63).
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

export type CustomerOrderStatus = "Draft" | "Submitted" | "Open" | "Closed" | "Cancelled" | "Rejected";

export type CustomerOrderAction = "submit" | "approve" | "reject" | "cancel" | "close";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const CUSTOMER_ORDER_ACTIONS: CustomerOrderAction[] = ["cancel", "reject", "close", "submit", "approve"];

export type CustomerOrderTransition = {
  label: string;
  permission: PermissionCode;
  from: CustomerOrderStatus[];
  to: CustomerOrderStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  done: string;
};

export const CUSTOMER_ORDER_TRANSITIONS: Record<CustomerOrderAction, CustomerOrderTransition> = {
  submit: {
    label: "Ajukan",
    permission: "CUSTOMER_ORDER_SUBMIT",
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Customer Order",
    body:
      "Pesanan dikunci dan menunggu persetujuan: customer, alamat, Kena PPN, " +
      "mode harga dan seluruh baris tidak dapat diubah lagi, dan tidak dapat " +
      "ditarik kembali. Tidak ada journal atau dokumen pajak yang dibuat.",
    confirmLabel: "Ya, Ajukan",
    done: "Customer Order diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "CUSTOMER_ORDER_APPROVE",
    from: ["Submitted"],
    to: "Open",
    icon: "check",
    tone: "primary",
    title: "Setujui Customer Order",
    body:
      "Pesanan menjadi Open: siap ditagihkan uang muka dan, nanti, dikirim " +
      "dengan Surat Jalan. Tidak ada journal atau dokumen pajak yang dibuat.",
    confirmLabel: "Ya, Setujui",
    done: "Customer Order disetujui",
  },
  reject: {
    label: "Tolak",
    permission: "CUSTOMER_ORDER_APPROVE",
    from: ["Submitted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak Customer Order",
    body:
      "Pesanan ditandai Ditolak dan tidak dapat dipakai lagi. Status ini " +
      "final; untuk mengajukan ulang, Salin pesanan ini menjadi Draft baru.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa pesanan ini ditolak…",
    done: "Customer Order ditolak",
  },
  cancel: {
    label: "Batalkan",
    permission: "CUSTOMER_ORDER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Customer Order",
    body:
      "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Status ini " +
      "final. Nomornya tetap tersimpan sebagai jejak.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa pesanan ini dibatalkan…",
    done: "Customer Order dibatalkan",
  },
  close: {
    label: "Tutup Pesanan",
    permission: "CUSTOMER_ORDER_CLOSE",
    from: ["Open"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Customer Order",
    body:
      "Pesanan ditutup walaupun belum seluruhnya dikirim: tidak ada Surat " +
      "Jalan atau tagihan uang muka baru yang dapat dibuat darinya. Tagihan " +
      "uang muka yang sudah terbit tidak berubah. Status ini final.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa pesanan ini ditutup…",
    done: "Customer Order ditutup",
  },
};

export function customerOrderTransitionAllowed(
  action: CustomerOrderAction,
  status: CustomerOrderStatus
): boolean {
  return CUSTOMER_ORDER_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; submitting locks the order. */
export function customerOrderIsEditable(status: CustomerOrderStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with Customer Orders — presentation only. */
export type CustomerOrderAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  close: boolean;
};

export function customerOrderAbilities(permissions: Iterable<string>): CustomerOrderAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("CUSTOMER_ORDER_CREATE"),
    edit: held.has("CUSTOMER_ORDER_EDIT"),
    submit: held.has("CUSTOMER_ORDER_SUBMIT"),
    approve: held.has("CUSTOMER_ORDER_APPROVE"),
    reject: held.has("CUSTOMER_ORDER_APPROVE"),
    cancel: held.has("CUSTOMER_ORDER_CANCEL"),
    close: held.has("CUSTOMER_ORDER_CLOSE"),
  };
}

/** The transitions this user may run on an order in this status. */
export function availableCustomerOrderActions(
  status: CustomerOrderStatus,
  can: CustomerOrderAbilities
): CustomerOrderAction[] {
  return CUSTOMER_ORDER_ACTIONS.filter(
    (a) => customerOrderTransitionAllowed(a, status) && can[a]
  );
}

export const CUSTOMER_ORDER_STATUS_TEXT: Record<CustomerOrderStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  Open: "Open",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
};

export const CUSTOMER_ORDER_STATUS_BADGE: Record<CustomerOrderStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
  Open: "s-ok",
  Closed: "s-mute",
  Cancelled: "s-mute",
  Rejected: "s-bad",
};

/** The final steps that carry a reason, and how the form introduces it. */
export const CUSTOMER_ORDER_REASON_TEXT: Partial<Record<CustomerOrderStatus, string>> = {
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
  Closed: "Ditutup",
};
