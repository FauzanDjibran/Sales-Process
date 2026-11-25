/**
 * The Penerapan Kredit's lifecycle (P332): Draft → Posted, Cancelled final.
 * A posted one is final; a Draft holds the credit and the Invoice balance it names.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type CreditApplicationStatus = "Draft" | "Posted" | "Cancelled";
export type CreditApplicationAction = "post" | "cancel";
const ACTIONS: CreditApplicationAction[] = ["cancel", "post"];

export type CreditApplicationTransition = {
  label: string;
  permission: PermissionCode;
  from: CreditApplicationStatus[];
  to: CreditApplicationStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const CREDIT_APPLICATION_TRANSITIONS: Record<CreditApplicationAction, CreditApplicationTransition> = {
  post: {
    label: "Posting",
    permission: "SALES_CREDIT_APPLICATION_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Posting Penerapan Kredit",
    body:
      "Kredit customer di setiap baris dipotongkan ke Invoice-nya: sisa kredit dan sisa tagihan turun sebesar nilai yang sama. " +
      "Penerapan Kredit yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Penerapan Kredit diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "SALES_CREDIT_APPLICATION_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Penerapan Kredit",
    body: "Draft ditandai Dibatalkan; kredit dan Invoice-nya dapat dipakai lagi. Tidak ada saldo yang berubah. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Penerapan Kredit ini dibatalkan…",
    done: "Penerapan Kredit dibatalkan",
  },
};

export function creditApplicationTransitionAllowed(action: CreditApplicationAction, status: CreditApplicationStatus): boolean {
  return CREDIT_APPLICATION_TRANSITIONS[action].from.includes(status);
}

export function creditApplicationIsEditable(status: CreditApplicationStatus): boolean {
  return status === "Draft";
}

export type CreditApplicationAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function creditApplicationAbilities(permissions: Iterable<string>): CreditApplicationAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("SALES_CREDIT_APPLICATION_CREATE"),
    edit: held.has("SALES_CREDIT_APPLICATION_EDIT"),
    post: held.has("SALES_CREDIT_APPLICATION_POST"),
    cancel: held.has("SALES_CREDIT_APPLICATION_CANCEL"),
  };
}

export function availableCreditApplicationActions(status: CreditApplicationStatus, can: CreditApplicationAbilities): CreditApplicationAction[] {
  return ACTIONS.filter((a) => creditApplicationTransitionAllowed(a, status) && can[a]);
}

export const CREDIT_APPLICATION_STATUS_TEXT: Record<CreditApplicationStatus, string> = { Draft: "Draft", Posted: "Diposting", Cancelled: "Dibatalkan" };
export const CREDIT_APPLICATION_STATUS_BADGE: Record<CreditApplicationStatus, string> = { Draft: "s-warn", Posted: "s-ok", Cancelled: "s-mute" };
