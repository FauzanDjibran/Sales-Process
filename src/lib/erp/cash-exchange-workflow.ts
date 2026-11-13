/**
 * Penukaran Valas's lifecycle and arithmetic, written once and read by both
 * sides (Multi-Currency-Plan MC11a).
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Client-safe on purpose — no `server-only`, no database import — so the form
 * shows the kind and the rate exactly as Posting reads them.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type CashExchangeStatus = "Draft" | "Posted" | "Cancelled";
export type CashExchangeAction = "post" | "cancel";
/** Which side is rupiah decides it: rupiah leaving buys, rupiah arriving sells. */
export type CashExchangeKind = "Buy" | "Sell";

export const CASH_EXCHANGE_PATH = "/finance/cash-bank/exchange";

export const CASH_EXCHANGE_KIND_TEXT: Record<CashExchangeKind, string> = {
  Buy: "Pembelian Valas",
  Sell: "Pencairan Valas",
};

/** The kind a pair of resources makes, or null when they are not rupiah and one foreign currency. */
export function cashExchangeKind(fromIsBase: boolean, toIsBase: boolean): CashExchangeKind | null {
  if (fromIsBase === toIsBase) return null;
  return fromIsBase ? "Buy" : "Sell";
}

/**
 * The rate the bank dealt at, rupiah per unit of foreign currency: the
 * quotient of the two amounts typed. Shown, never stored and never multiplied
 * back (multi_currency_concept §4.2); null until both amounts are there.
 */
export function cashExchangeRate(kind: CashExchangeKind, fromAmount: number, toAmount: number): number | null {
  if (!(fromAmount > 0) || !(toAmount > 0)) return null;
  return kind === "Buy" ? fromAmount / toAmount : toAmount / fromAmount;
}

export type CashExchangeTransition = {
  label: string;
  permission: PermissionCode;
  from: CashExchangeStatus[];
  to: CashExchangeStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const CASH_EXCHANGE_TRANSITIONS: Record<CashExchangeAction, CashExchangeTransition> = {
  post: {
    label: "Posting",
    permission: "CASH_EXCHANGE_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "send",
    tone: "primary",
    title: "Posting Penukaran Valas",
    body:
      "Dana keluar dari Kas & Bank asal dan masuk ke Kas & Bank tujuan pada tanggal dokumen, dan journal di bawah ditulis. " +
      "Valas yang keluar dinilai pada kurs rata-ratanya. Dokumen yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Penukaran Valas diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "CASH_EXCHANGE_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Penukaran Valas",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada dana yang berpindah. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa penukaran ini dibatalkan…",
    done: "Penukaran Valas dibatalkan",
  },
};

const ACTIONS: CashExchangeAction[] = ["cancel", "post"];

export function cashExchangeTransitionAllowed(action: CashExchangeAction, status: CashExchangeStatus): boolean {
  return CASH_EXCHANGE_TRANSITIONS[action].from.includes(status);
}

export function cashExchangeIsEditable(status: CashExchangeStatus): boolean {
  return status === "Draft";
}

export type CashExchangeAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function cashExchangeAbilities(permissions: Iterable<string>): CashExchangeAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("CASH_EXCHANGE_CREATE"),
    edit: held.has("CASH_EXCHANGE_EDIT"),
    post: held.has("CASH_EXCHANGE_POST"),
    cancel: held.has("CASH_EXCHANGE_CANCEL"),
  };
}

export function availableCashExchangeActions(status: CashExchangeStatus, can: CashExchangeAbilities): CashExchangeAction[] {
  return ACTIONS.filter((a) => cashExchangeTransitionAllowed(a, status) && can[a]);
}

export const CASH_EXCHANGE_STATUS_TEXT: Record<CashExchangeStatus, string> = {
  Draft: "Draft",
  Posted: "Posted",
  Cancelled: "Dibatalkan",
};

export const CASH_EXCHANGE_STATUS_BADGE: Record<CashExchangeStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
