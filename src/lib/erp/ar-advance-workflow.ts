/**
 * The AR advance bill's lifecycle (P57), written once and read by both sides.
 *
 *   Draft ──issue──> Issued ──cancel──> Cancelled
 *     └──────────cancel─────────────────┘
 *
 * Issuing posts nothing: a bill is not a transaction. The money, its journal
 * and the figures of the Faktur Pajak Uang Muka come with the payment, in
 * Penerimaan Kas & Bank. A bill a posted receipt has settled, even in part,
 * refuses Batalkan (P66); its leftover is refunded instead.
 *
 * The same shape as `customer-order-workflow.ts`, and the one the AP advance will
 * mirror (P58). Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type AdvanceStatus = "Draft" | "Issued" | "Cancelled";

export type AdvanceAction = "issue" | "cancel";

export type AdvanceTransition = {
  label: string;
  permission: PermissionCode;
  from: AdvanceStatus[];
  to: AdvanceStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  needsReason?: boolean;
  done: string;
};

export const SALES_ADVANCE_TRANSITIONS: Record<AdvanceAction, AdvanceTransition> = {
  issue: {
    label: "Terbitkan",
    permission: "SALES_ADVANCE_ISSUE",
    from: ["Draft"],
    to: "Issued",
    icon: "send",
    tone: "primary",
    title: "Terbitkan Tagihan Uang Muka",
    body:
      "Tagihan dikunci dan siap dikirim ke customer. Tidak ada journal dan tidak ada " +
      "faktur pajak: kas, Uang Muka Penjualan dan PPN Keluaran baru dicatat saat " +
      "pembayarannya diterima di menu Penerimaan Kas & Bank, dan tanggal terima itu menjadi " +
      "tanggal Faktur Pajak Uang Muka.",
    confirmLabel: "Ya, Terbitkan",
    done: "Tagihan uang muka diterbitkan",
  },
  cancel: {
    label: "Batalkan",
    permission: "SALES_ADVANCE_CANCEL",
    from: ["Draft", "Issued"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Konfirmasi Batalkan Tagihan Uang Muka",
    body:
      "Tagihan ditandai Dibatalkan dan nilainya kembali menjadi sisa Customer Order yang " +
      "dapat ditagih. Tidak ada journal atau pajak yang terpengaruh karena tagihan " +
      "tidak pernah memposting. Status Dibatalkan bersifat final.",
    confirmLabel: "Ya, Batalkan",
    needsReason: true,
    done: "Tagihan uang muka dibatalkan",
  },
};

export function advanceTransitionAllowed(action: AdvanceAction, status: AdvanceStatus): boolean {
  return SALES_ADVANCE_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; issuing locks the bill. */
export function advanceIsEditable(status: AdvanceStatus): boolean {
  return status === "Draft";
}

/** What the signed-in user may do with advance bills — presentation only. */
export type AdvanceAbilities = {
  create: boolean;
  edit: boolean;
  issue: boolean;
  cancel: boolean;
};

export function salesAdvanceAbilities(permissions: Iterable<string>): AdvanceAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("SALES_ADVANCE_CREATE"),
    edit: held.has("SALES_ADVANCE_EDIT"),
    issue: held.has("SALES_ADVANCE_ISSUE"),
    cancel: held.has("SALES_ADVANCE_CANCEL"),
  };
}

export function availableAdvanceActions(status: AdvanceStatus, can: AdvanceAbilities): AdvanceAction[] {
  return (["issue", "cancel"] as AdvanceAction[]).filter(
    (a) => advanceTransitionAllowed(a, status) && can[a]
  );
}

export const ADVANCE_STATUS_TEXT: Record<AdvanceStatus, string> = {
  Draft: "Draft",
  Issued: "Diterbitkan",
  Cancelled: "Dibatalkan",
};

export const ADVANCE_STATUS_BADGE: Record<AdvanceStatus, string> = {
  Draft: "s-warn",
  Issued: "s-info",
  Cancelled: "s-mute",
};

/**
 * Uang Muka Perizinan (P137, Z12): the same lifecycle as the sales advance
 * bill, with its own permissions and its own words.
 */
export const PERMIT_ADVANCE_TRANSITIONS: Record<AdvanceAction, AdvanceTransition> = {
  issue: {
    ...SALES_ADVANCE_TRANSITIONS.issue,
    permission: "PERMIT_ADVANCE_ISSUE",
    title: "Terbitkan Uang Muka Perizinan",
    body:
      "Tagihan dikunci dan siap dikirim ke customer. Tidak ada journal dan tidak ada " +
      "faktur pajak: kas, Uang Muka Perizinan dan PPN Keluaran baru dicatat saat " +
      "pembayarannya diterima di menu Penerimaan Kas & Bank, dan tanggal terima itu menjadi " +
      "tanggal Faktur Pajak Uang Muka.",
    done: "Uang Muka Perizinan diterbitkan",
  },
  cancel: {
    ...SALES_ADVANCE_TRANSITIONS.cancel,
    permission: "PERMIT_ADVANCE_CANCEL",
    title: "Konfirmasi Batalkan Uang Muka Perizinan",
    body:
      "Tagihan ditandai Dibatalkan dan nilainya kembali menjadi sisa estimasi Pengajuan " +
      "Perizinan yang dapat ditagih. Tidak ada journal atau pajak yang terpengaruh karena " +
      "tagihan tidak pernah memposting. Status Dibatalkan bersifat final.",
    done: "Uang Muka Perizinan dibatalkan",
  },
};

export function permitAdvanceAbilities(permissions: Iterable<string>): AdvanceAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PERMIT_ADVANCE_CREATE"),
    edit: held.has("PERMIT_ADVANCE_EDIT"),
    issue: held.has("PERMIT_ADVANCE_ISSUE"),
    cancel: held.has("PERMIT_ADVANCE_CANCEL"),
  };
}

/** Which advance bill a screen shows: Uang Muka Penjualan or Uang Muka Perizinan. */
export type AdvanceVariant = "sales" | "permit";

export const ADVANCE_TRANSITIONS_OF: Record<AdvanceVariant, Record<AdvanceAction, AdvanceTransition>> = {
  sales: SALES_ADVANCE_TRANSITIONS,
  permit: PERMIT_ADVANCE_TRANSITIONS,
};
