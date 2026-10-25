/**
 * The hand-over's lifecycle — the BSTB between workstations (Walet step 4,
 * P167, M113), written once and read by both sides.
 *
 *   Draft ──post──> Posted (Dikirim) ──receive──> Received
 *     │                    │
 *     │                    └──reject──> Rejected
 *     └──cancel──> Cancelled
 *
 * Posting hands the goods on: they leave the sending station and wait **in
 * transit** to the next, no value changes and there is no journal. The
 * receiving station takes the **whole** sending (Terima) or sends it **back
 * whole** to the sender (Tolak, with a reason) — never a part. Batalkan is for
 * a Draft only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type HandoverStatus = "Draft" | "Posted" | "Received" | "Rejected" | "Cancelled";

export type HandoverAction = "post" | "cancel" | "receive" | "reject";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const HANDOVER_ACTIONS: HandoverAction[] = ["cancel", "reject", "post", "receive"];

export type HandoverTransition = {
  label: string;
  permission: PermissionCode;
  from: HandoverStatus[];
  to: HandoverStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for, which is stored and shown — its prompt. */
  reason?: string;
  /** The step asks for the day it happens (Terima, Tolak). */
  dated?: boolean;
  done: string;
};

export const HANDOVER_TRANSITIONS: Record<HandoverAction, HandoverTransition> = {
  post: {
    label: "Posting",
    permission: "PRODUCTION_HANDOVER_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "truck",
    tone: "primary",
    title: "Posting Hand-over",
    body:
      "Barang diserahkan dari Workstation pengirim ke Workstation tujuan pada Tanggal, per lot dengan nomor yang sama; " +
      "selama belum diterima, barang dalam perjalanan. Hand-over pertama sebuah Partai memulai Partai itu dan membagi barang ke Job. " +
      "Nilainya tidak berubah dan tidak ada journal. Hand-over yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Hand-over diposting — barang dalam perjalanan",
  },
  receive: {
    label: "Terima",
    permission: "PRODUCTION_HANDOVER_RECEIVE",
    from: ["Posted"],
    to: "Received",
    icon: "check",
    tone: "primary",
    title: "Terima di Workstation",
    body:
      "Workstation tujuan menerima seluruh kiriman ini, per lot, pada tanggal di bawah; sejak itu barang dapat dikerjakan. " +
      "Nilainya tidak berubah dan tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Terima",
    dated: true,
    done: "Hand-over diterima",
  },
  reject: {
    label: "Tolak",
    permission: "PRODUCTION_HANDOVER_RECEIVE",
    from: ["Posted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak di Workstation",
    body:
      "Workstation tujuan menolak seluruh kiriman ini: barang kembali ke Workstation pengirim, lot dan Job yang sama, " +
      "senilai saat dikirim. Tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa kiriman ini ditolak…",
    dated: true,
    done: "Hand-over ditolak — barang kembali ke Workstation pengirim",
  },
  cancel: {
    label: "Batalkan",
    permission: "PRODUCTION_HANDOVER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Hand-over",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada barang yang bergerak dan tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Hand-over ini dibatalkan…",
    done: "Hand-over dibatalkan",
  },
};

export function handoverTransitionAllowed(action: HandoverAction, status: HandoverStatus): boolean {
  return HANDOVER_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; posting makes it final. */
export function handoverIsEditable(status: HandoverStatus): boolean {
  return status === "Draft";
}

/** The goods have been handed on: sent, received or sent back. */
export function handoverIsPosted(status: HandoverStatus): boolean {
  return status === "Posted" || status === "Received" || status === "Rejected";
}

/** What the signed-in user may do with hand-overs — presentation only. */
export type HandoverAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
  receive: boolean;
  reject: boolean;
};

export function handoverAbilities(permissions: Iterable<string>): HandoverAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PRODUCTION_HANDOVER_CREATE"),
    edit: held.has("PRODUCTION_HANDOVER_EDIT"),
    post: held.has("PRODUCTION_HANDOVER_POST"),
    cancel: held.has("PRODUCTION_HANDOVER_CANCEL"),
    receive: held.has("PRODUCTION_HANDOVER_RECEIVE"),
    reject: held.has("PRODUCTION_HANDOVER_RECEIVE"),
  };
}

/** The transitions this user may run on a hand-over in this status. */
export function availableHandoverActions(status: HandoverStatus, can: HandoverAbilities): HandoverAction[] {
  return HANDOVER_ACTIONS.filter((a) => handoverTransitionAllowed(a, status) && can[a]);
}

export const HANDOVER_STATUS_TEXT: Record<HandoverStatus, string> = {
  Draft: "Draft",
  Posted: "Dikirim",
  Received: "Diterima",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
};

export const HANDOVER_STATUS_BADGE: Record<HandoverStatus, string> = {
  Draft: "s-warn",
  Posted: "s-info",
  Received: "s-ok",
  Rejected: "s-bad",
  Cancelled: "s-mute",
};
