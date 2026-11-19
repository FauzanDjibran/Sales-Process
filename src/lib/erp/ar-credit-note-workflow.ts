/**
 * The Credit Note Penjualan's lifecycle and arithmetic, written once and read
 * by both sides (P292, `Sales-Return-Plan.md` §6).
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting reverses what the Invoice booked for the goods that came back:
 * Penjualan through Retur Penjualan, PPN Keluaran, and Piutang through a Retur
 * AR item applied to the Invoice's. A posted Credit Note is final.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";
import { cumulativeShare } from "./receipt-note-workflow";

export type CreditNoteStatus = "Draft" | "Posted" | "Cancelled";
export type CreditNoteAction = "post" | "cancel";
export const CREDIT_NOTE_ACTIONS: CreditNoteAction[] = ["cancel", "post"];

export type CreditNoteTransition = {
  label: string;
  permission: PermissionCode;
  from: CreditNoteStatus[];
  to: CreditNoteStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const CREDIT_NOTE_TRANSITIONS: Record<CreditNoteAction, CreditNoteTransition> = {
  post: {
    label: "Posting",
    permission: "SALES_CREDIT_NOTE_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Posting Credit Note Penjualan",
    body:
      "Penjualan dan PPN Keluaran atas barang yang kembali dikurangi, dan piutang customer turun dengan " +
      "journal di bawah ini pada Tanggal Credit Note. Sisa yang tidak tertutup piutang Invoice menjadi kredit " +
      "customer. Credit Note yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Credit Note Penjualan diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "SALES_CREDIT_NOTE_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Credit Note Penjualan",
    body: "Draft ditandai Dibatalkan; barang yang kembali dapat dikredit lagi. Tidak ada journal yang dibuat. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Credit Note ini dibatalkan…",
    done: "Credit Note Penjualan dibatalkan",
  },
};

export function creditNoteTransitionAllowed(action: CreditNoteAction, status: CreditNoteStatus): boolean {
  return CREDIT_NOTE_TRANSITIONS[action].from.includes(status);
}

export function creditNoteIsEditable(status: CreditNoteStatus): boolean {
  return status === "Draft";
}

/** The statuses that hold what they credit: a cancelled note gives it back. */
export const CREDIT_NOTE_HOLDS: CreditNoteStatus[] = ["Draft", "Posted"];

export type CreditNoteAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function creditNoteAbilities(permissions: Iterable<string>): CreditNoteAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("SALES_CREDIT_NOTE_CREATE"),
    edit: held.has("SALES_CREDIT_NOTE_EDIT"),
    post: held.has("SALES_CREDIT_NOTE_POST"),
    cancel: held.has("SALES_CREDIT_NOTE_CANCEL"),
  };
}

export function availableCreditNoteActions(status: CreditNoteStatus, can: CreditNoteAbilities): CreditNoteAction[] {
  return CREDIT_NOTE_ACTIONS.filter((a) => creditNoteTransitionAllowed(a, status) && can[a]);
}

export const CREDIT_NOTE_STATUS_TEXT: Record<CreditNoteStatus, string> = { Draft: "Draft", Posted: "Diposting", Cancelled: "Dibatalkan" };
export const CREDIT_NOTE_STATUS_BADGE: Record<CreditNoteStatus, string> = { Draft: "s-warn", Posted: "s-ok", Cancelled: "s-mute" };

/** An Invoice line's figures, in its currency and in base. */
export type CreditedLine = { qty: number; gross: number; discount: number; dpp: number; dppOther: number; ppn: number; baseDpp: number; basePpn: number };

/**
 * What crediting `qty` of an Invoice line is worth: each figure the cumulative
 * share of the line's own figure (P112, `tax_concept.md` §7.5) after what
 * posted Credit Notes credited of it (`before`). So credits never add up to more
 * than the line, and one that completes the line lands on its figures exactly.
 * PPN is the line's own share, never recomputed: the credit reverses exactly
 * what the Invoice reported. `scale` is the currency's minor unit (MC5); base
 * figures are kept to the cent.
 */
export function creditLine(line: CreditedLine, before: number, qty: number, scale = 1): Omit<CreditedLine, "qty"> {
  const share = (amount: number, s = scale) => cumulativeShare(amount, line.qty, before, qty, s);
  return {
    gross: share(line.gross),
    discount: share(line.discount),
    dpp: share(line.dpp),
    dppOther: share(line.dppOther),
    ppn: share(line.ppn),
    baseDpp: share(line.baseDpp, 100),
    basePpn: share(line.basePpn, 100),
  };
}
