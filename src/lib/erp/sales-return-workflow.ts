/**
 * The Sales Return's lifecycle, written once and read by both sides (P287).
 *
 *   Draft ──submit──> Submitted ──approve──> Open ──close──> Closed
 *     │                   │
 *     └──cancel──> Cancelled   └──reject──> Rejected
 *
 * Approved like a Customer Order (SR4): a return touches revenue and stock, so
 * someone other than the clerk agrees to it. An Open return may be received by
 * the warehouse on a Receipt Note `sales_return`, which closes it once every
 * line is back; Tutup closes it by hand, releasing what never came. It posts
 * nothing at any step.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type SalesReturnStatus = "Draft" | "Submitted" | "Open" | "Closed" | "Cancelled" | "Rejected";

export type SalesReturnAction = "submit" | "approve" | "reject" | "cancel" | "close";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const SALES_RETURN_ACTIONS: SalesReturnAction[] = ["cancel", "reject", "close", "submit", "approve"];

export type SalesReturnTransition = {
  label: string;
  permission: PermissionCode;
  from: SalesReturnStatus[];
  to: SalesReturnStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  done: string;
};

export const SALES_RETURN_TRANSITIONS: Record<SalesReturnAction, SalesReturnTransition> = {
  submit: {
    label: "Ajukan",
    permission: "SALES_RETURN_SUBMIT",
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Sales Return",
    body:
      "Sales Return dikunci dan menunggu persetujuan: alamat, alasan dan jumlah per barang " +
      "tidak dapat diubah lagi, dan tidak dapat ditarik kembali. Tidak ada journal atau " +
      "pergerakan stok yang dibuat.",
    confirmLabel: "Ya, Ajukan",
    done: "Sales Return diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "SALES_RETURN_APPROVE",
    from: ["Submitted"],
    to: "Open",
    icon: "check",
    tone: "primary",
    title: "Setujui Sales Return",
    body:
      "Sales Return menjadi Open: gudang dapat menerima barangnya dengan Receipt Note. " +
      "Tidak ada journal atau pergerakan stok yang dibuat sekarang.",
    confirmLabel: "Ya, Setujui",
    done: "Sales Return disetujui",
  },
  reject: {
    label: "Tolak",
    permission: "SALES_RETURN_APPROVE",
    from: ["Submitted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak Sales Return",
    body:
      "Sales Return ditandai Ditolak dan tidak dapat dipakai lagi; jumlahnya kembali dapat " +
      "diretur dengan Sales Return lain. Status ini final.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa Sales Return ini ditolak…",
    done: "Sales Return ditolak",
  },
  cancel: {
    label: "Batalkan",
    permission: "SALES_RETURN_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Sales Return",
    body:
      "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi; jumlahnya kembali dapat " +
      "diretur. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Sales Return ini dibatalkan…",
    done: "Sales Return dibatalkan",
  },
  close: {
    label: "Tutup",
    permission: "SALES_RETURN_CLOSE",
    from: ["Open"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Sales Return",
    body:
      "Sales Return ditutup walaupun belum seluruhnya diterima gudang. Hanya jumlah yang " +
      "sudah diterima yang tetap tercatat; sisanya dapat diretur lagi. Status ini final.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa Sales Return ini ditutup…",
    done: "Sales Return ditutup",
  },
};

export function salesReturnTransitionAllowed(action: SalesReturnAction, status: SalesReturnStatus): boolean {
  return SALES_RETURN_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; submitting locks the return. */
export function salesReturnIsEditable(status: SalesReturnStatus): boolean {
  return status === "Draft";
}

/**
 * The statuses whose quantity is taken from the Delivery Note line. A cancelled
 * or rejected return gives it back; a closed one holds only what was received.
 */
export const SALES_RETURN_HOLDS_QTY: SalesReturnStatus[] = ["Draft", "Submitted", "Open", "Closed"];

/** Why a return was given back to the customer (SR3) — a catalogue in code. */
export const SALES_RETURN_REASONS = [
  { key: "damaged", label: "Barang rusak" },
  { key: "wrong_item", label: "Salah kirim" },
  { key: "expired", label: "Kadaluarsa" },
  { key: "mismatch", label: "Tidak sesuai pesanan" },
  { key: "other", label: "Lainnya" },
] as const;

export type SalesReturnReason = (typeof SALES_RETURN_REASONS)[number]["key"];

export function salesReturnReasonLabel(key: string): string {
  return SALES_RETURN_REASONS.find((r) => r.key === key)?.label ?? key;
}

/** What the signed-in user may do with Sales Returns — presentation only. */
export type SalesReturnAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  close: boolean;
};

export function salesReturnAbilities(permissions: Iterable<string>): SalesReturnAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("SALES_RETURN_CREATE"),
    edit: held.has("SALES_RETURN_EDIT"),
    submit: held.has("SALES_RETURN_SUBMIT"),
    approve: held.has("SALES_RETURN_APPROVE"),
    reject: held.has("SALES_RETURN_APPROVE"),
    cancel: held.has("SALES_RETURN_CANCEL"),
    close: held.has("SALES_RETURN_CLOSE"),
  };
}

/** The transitions this user may run on a return in this status. */
export function availableSalesReturnActions(status: SalesReturnStatus, can: SalesReturnAbilities): SalesReturnAction[] {
  return SALES_RETURN_ACTIONS.filter((a) => salesReturnTransitionAllowed(a, status) && can[a]);
}

export const SALES_RETURN_STATUS_TEXT: Record<SalesReturnStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  Open: "Open",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
};

export const SALES_RETURN_STATUS_BADGE: Record<SalesReturnStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
  Open: "s-ok",
  Closed: "s-mute",
  Cancelled: "s-mute",
  Rejected: "s-bad",
};

/** The final steps that carry a reason, and how the form introduces it. */
export const SALES_RETURN_REASON_TEXT: Partial<Record<SalesReturnStatus, string>> = {
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
  Closed: "Ditutup",
};
