/**
 * The lifecycle production documents share, written once and read by both
 * sides.
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting moves the goods through the production ledger (and the stock books
 * and the journal where the document says so). A posted document is final; a
 * mistake is corrected by another document. Batalkan is for a Draft only,
 * with a reason. Each document gives its own words and permissions.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type ProdDocStatus = "Draft" | "Posted" | "Cancelled";

export type ProdDocAction = "post" | "cancel";

/** The order the header offers them in, before `orderForHeader` sorts by tone. */
export const PROD_DOC_ACTIONS: ProdDocAction[] = ["cancel", "post"];

export type ProdDocTransition = {
  label: string;
  permission: PermissionCode;
  from: ProdDocStatus[];
  to: ProdDocStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  /** The reason the step asks for — its prompt. */
  reason?: string;
  done: string;
};

export type ProdDocAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export type ProdDocWorkflow = {
  /** The document's name, as the header and the toasts read it. */
  noun: string;
  path: string;
  /** Whether Posting writes a journal, so its confirmation shows one (P103). */
  journal: boolean;
  transitions: Record<ProdDocAction, ProdDocTransition>;
  abilities: (permissions: Iterable<string>) => ProdDocAbilities;
};

/** A document's workflow from its words and its permission prefix (`<PREFIX>_POST`, …). */
export function prodDocWorkflow(c: { noun: string; prefix: string; path: string; journal: boolean; postIcon: IconName; postBody: string }): ProdDocWorkflow {
  const perm = (a: string) => `${c.prefix}_${a}` as PermissionCode;
  return {
    noun: c.noun,
    path: c.path,
    journal: c.journal,
    transitions: {
      post: {
        label: "Posting",
        permission: perm("POST"),
        from: ["Draft"],
        to: "Posted",
        icon: c.postIcon,
        tone: "primary",
        title: `Posting ${c.noun}`,
        body: `${c.postBody} ${c.noun} yang sudah diposting tidak dapat diubah atau dibatalkan.`,
        confirmLabel: "Ya, Posting",
        done: `${c.noun} diposting`,
      },
      cancel: {
        label: "Batalkan",
        permission: perm("CANCEL"),
        from: ["Draft"],
        to: "Cancelled",
        icon: "block",
        tone: "danger",
        title: `Batalkan ${c.noun}`,
        body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada barang yang bergerak dan tidak ada journal. Status ini final.",
        confirmLabel: "Ya, Batalkan",
        reason: `Mengapa ${c.noun} ini dibatalkan…`,
        done: `${c.noun} dibatalkan`,
      },
    },
    abilities: (permissions) => {
      const held = permissions instanceof Set ? permissions : new Set(permissions);
      return { create: held.has(perm("CREATE")), edit: held.has(perm("EDIT")), post: held.has(perm("POST")), cancel: held.has(perm("CANCEL")) };
    },
  };
}

export function prodDocTransitionAllowed(w: ProdDocWorkflow, action: ProdDocAction, status: ProdDocStatus): boolean {
  return w.transitions[action].from.includes(status);
}

/** Only a Draft can be edited; posting makes it final. */
export function prodDocIsEditable(status: ProdDocStatus): boolean {
  return status === "Draft";
}

/** The transitions this user may run on a document in this status. */
export function availableProdDocActions(w: ProdDocWorkflow, status: ProdDocStatus, can: ProdDocAbilities): ProdDocAction[] {
  return PROD_DOC_ACTIONS.filter((a) => prodDocTransitionAllowed(w, a, status) && can[a]);
}

export const PROD_DOC_STATUS_TEXT: Record<ProdDocStatus, string> = {
  Draft: "Draft",
  Posted: "Diposting",
  Cancelled: "Dibatalkan",
};

export const PROD_DOC_STATUS_BADGE: Record<ProdDocStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
