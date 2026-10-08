import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

/**
 * The Pengajuan Perizinan's lifecycle (P137, Perizinan-Concept.md Z6–Z7):
 * Draft → Ajukan → Diajukan → Setujui → Disetujui → Realisasikan →
 * Terealisasi → (its Invoice Perizinan posted) → Selesai. The approval is the
 * Customer Order's (QZ6). Client-safe: the form and the header buttons read it.
 */

export type PermitRequestStatus = "Draft" | "Submitted" | "Open" | "Realized" | "Done" | "Cancelled" | "Rejected";

export type PermitRequestAction = "submit" | "approve" | "reject" | "cancel" | "realize";

export const PERMIT_REQUEST_ACTIONS: PermitRequestAction[] = ["cancel", "reject", "submit", "approve", "realize"];

export type PermitRequestTransition = {
  label: string;
  permission: PermissionCode;
  from: PermitRequestStatus[];
  to: PermitRequestStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The prompt of the reason the step asks for. */
  reason?: string;
  done: string;
};

export const PERMIT_REQUEST_TRANSITIONS: Record<PermitRequestAction, PermitRequestTransition> = {
  submit: {
    label: "Ajukan",
    permission: "PERMIT_REQUEST_SUBMIT",
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Pengajuan Perizinan",
    body:
      "Pengajuan dikunci dan menunggu persetujuan: customer, Kena PPN, mode harga, " +
      "Jenis PPh dan harga estimasi setiap perizinan tidak dapat diubah lagi. Tidak ada " +
      "journal atau dokumen pajak yang dibuat.",
    confirmLabel: "Ya, Ajukan",
    done: "Pengajuan Perizinan diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "PERMIT_REQUEST_APPROVE",
    from: ["Submitted"],
    to: "Open",
    icon: "check",
    tone: "primary",
    title: "Setujui Pengajuan Perizinan",
    body:
      "Pengajuan disetujui: harga estimasi menjadi dasar Uang Muka Perizinan, dan harga " +
      "sebenarnya dicatat nanti lewat realisasi di dokumen ini. Tidak ada journal atau " +
      "dokumen pajak yang dibuat.",
    confirmLabel: "Ya, Setujui",
    done: "Pengajuan Perizinan disetujui",
  },
  reject: {
    label: "Tolak",
    permission: "PERMIT_REQUEST_APPROVE",
    from: ["Submitted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak Pengajuan Perizinan",
    body: "Pengajuan ditandai Ditolak dan tidak dapat dipakai lagi. Status ini final.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa pengajuan ini ditolak…",
    done: "Pengajuan Perizinan ditolak",
  },
  cancel: {
    label: "Batalkan",
    permission: "PERMIT_REQUEST_CANCEL",
    from: ["Draft", "Open"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Pengajuan Perizinan",
    body:
      "Pengajuan ditandai Dibatalkan dan tidak dapat dipakai untuk uang muka maupun " +
      "realisasi. Ditolak bila masih ada Uang Muka Perizinan yang berlaku atasnya. " +
      "Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa pengajuan ini dibatalkan…",
    done: "Pengajuan Perizinan dibatalkan",
  },
  realize: {
    label: "Realisasikan",
    permission: "PERMIT_REQUEST_REALIZE",
    from: ["Open"],
    to: "Realized",
    icon: "check",
    tone: "primary",
    title: "Realisasikan Perizinan",
    body:
      "Harga sebenarnya setiap perizinan dicatat dan nomor realisasi diberikan. Realisasi " +
      "menjadi dasar Biaya Perizinan dan Invoice Perizinan; masih dapat diubah sampai " +
      "ditagih atau biayanya dibayar. Tidak ada journal — biaya dibukukan saat dibayar, " +
      "pendapatan saat invoice diposting.",
    confirmLabel: "Ya, Realisasikan",
    done: "Perizinan direalisasi",
  },
};

export function permitRequestTransitionAllowed(action: PermitRequestAction, status: PermitRequestStatus): boolean {
  return PERMIT_REQUEST_TRANSITIONS[action].from.includes(status);
}

export function permitRequestIsEditable(status: PermitRequestStatus): boolean {
  return status === "Draft";
}

export type PermitRequestAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  realize: boolean;
};

export function permitRequestAbilities(permissions: Iterable<string>): PermitRequestAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PERMIT_REQUEST_CREATE"),
    edit: held.has("PERMIT_REQUEST_EDIT"),
    submit: held.has("PERMIT_REQUEST_SUBMIT"),
    approve: held.has("PERMIT_REQUEST_APPROVE"),
    reject: held.has("PERMIT_REQUEST_APPROVE"),
    cancel: held.has("PERMIT_REQUEST_CANCEL"),
    realize: held.has("PERMIT_REQUEST_REALIZE"),
  };
}

export function availablePermitRequestActions(
  status: PermitRequestStatus,
  can: PermitRequestAbilities
): PermitRequestAction[] {
  return PERMIT_REQUEST_ACTIONS.filter((a) => permitRequestTransitionAllowed(a, status) && can[a]);
}

export const PERMIT_REQUEST_STATUS_TEXT: Record<PermitRequestStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  Open: "Disetujui",
  Realized: "Terealisasi",
  Done: "Selesai",
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
};

export const PERMIT_REQUEST_STATUS_BADGE: Record<PermitRequestStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
  Open: "s-ok",
  Realized: "s-ok",
  Done: "s-mute",
  Cancelled: "s-mute",
  Rejected: "s-bad",
};

export const PERMIT_REQUEST_REASON_TEXT: Partial<Record<PermitRequestStatus, string>> = {
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
};
