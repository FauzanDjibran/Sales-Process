/**
 * A cash and bank transaction's lifecycle (P66), written once and read by both
 * sides.
 *
 *   Draft ──post──> Posted
 *     └──cancel──> Cancelled
 *
 * A Draft touches no book. Posting writes the journal and the Cash Bank Book
 * in one transaction and is permanent: a posted receipt is corrected by a new
 * document, never edited or reversed (§2 rules 6–7). Only a Draft is
 * cancelled.
 *
 * Penerimaan and Pengeluaran share the table and the lifecycle but not the
 * permissions, so receiving and paying money can be held by different people.
 * Only Penerimaan exists yet.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type CashBankTxStatus = "Draft" | "Posted" | "Cancelled";

export type CashBankTxAction = "post" | "cancel";

export type CashBankTxTransition = {
  label: string;
  permission: PermissionCode;
  from: CashBankTxStatus[];
  to: CashBankTxStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  confirmLabel: string;
  needsReason?: boolean;
  done: string;
};

export const CASH_RECEIPT_TRANSITIONS: Record<CashBankTxAction, CashBankTxTransition> = {
  post: {
    label: "Posting",
    permission: "CASH_RECEIPT_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Posting Penerimaan",
    confirmLabel: "Ya, Posting",
    done: "Penerimaan diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "CASH_RECEIPT_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Penerimaan",
    confirmLabel: "Ya, Batalkan",
    needsReason: true,
    done: "Penerimaan dibatalkan",
  },
};

export function cashReceiptTransitionAllowed(action: CashBankTxAction, status: CashBankTxStatus): boolean {
  return CASH_RECEIPT_TRANSITIONS[action].from.includes(status);
}

export function cashBankTxIsEditable(status: CashBankTxStatus): boolean {
  return status === "Draft";
}

export type CashReceiptAbilities = {
  create: boolean;
  edit: boolean;
  post: boolean;
  cancel: boolean;
};

export function cashReceiptAbilities(permissions: Iterable<string>): CashReceiptAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("CASH_RECEIPT_CREATE"),
    edit: held.has("CASH_RECEIPT_EDIT"),
    post: held.has("CASH_RECEIPT_POST"),
    cancel: held.has("CASH_RECEIPT_CANCEL"),
  };
}

export function availableCashReceiptActions(
  status: CashBankTxStatus,
  can: CashReceiptAbilities
): CashBankTxAction[] {
  return (["cancel", "post"] as CashBankTxAction[]).filter(
    (a) => cashReceiptTransitionAllowed(a, status) && can[a]
  );
}

export const CASH_BANK_TX_STATUS_TEXT: Record<CashBankTxStatus, string> = {
  Draft: "Draft",
  Posted: "Posted",
  Cancelled: "Dibatalkan",
};

export const CASH_BANK_TX_STATUS_BADGE: Record<CashBankTxStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
