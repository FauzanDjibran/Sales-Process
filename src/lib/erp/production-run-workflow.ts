/**
 * The Eksekusi Produksi's lifecycle (Walet step 5, P169, M114), written once and
 * read by both sides.
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting is the moment the goods change: inputs are taken from the station's
 * buckets, the outputs are registered and filled — at Σ inputs plus the station's
 * standard — and the standard is booked into WIP, with one journal (Dr / Cr WIP
 * by Kategori Item, Cr each Standard Cost Item's account with the station's Cost
 * Center). A posted run is final: a correction is a new run. Batalkan is for a
 * Draft only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type ExecutionStatus = "Draft" | "Posted" | "Cancelled";

export type ExecutionAction = "post" | "cancel";

export const EXECUTION_ACTIONS: ExecutionAction[] = ["cancel", "post"];

/** *Mix* is the Moulding mix, *Transform* turns inputs into new lots, *PassThrough* keeps the lot. */
export type ExecutionKind = "Mix" | "Transform" | "PassThrough";

export const EXECUTION_KIND_TEXT: Record<ExecutionKind, string> = {
  Mix: "Mix (menjadi satu lot)",
  Transform: "Transformasi",
  PassThrough: "Pass-through (lot tetap)",
};

/** What Cara Kerja a workstation has (P166) allows as a run: Mix + Transformasi may do either. */
export function kindsOfMode(mode: "Mix" | "Transform" | "PassThrough" | "MixTransform" | string): ExecutionKind[] {
  switch (mode) {
    case "PassThrough":
      return ["PassThrough"];
    case "MixTransform":
    case "Mix":
      return ["Mix", "Transform"];
    default:
      return ["Transform"];
  }
}

export type ExecutionOutputStatus = "Available" | "Reject";

export const EXECUTION_OUTPUT_STATUS_TEXT: Record<ExecutionOutputStatus, string> = { Available: "Tersedia", Reject: "Reject" };

export type ExecutionTransition = {
  label: string;
  permission: PermissionCode;
  from: ExecutionStatus[];
  to: ExecutionStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  /** The step writes a journal, shown by a dry run in its confirmation (P103). */
  journal?: boolean;
  done: string;
};

export const EXECUTION_TRANSITIONS: Record<ExecutionAction, ExecutionTransition> = {
  post: {
    label: "Posting",
    permission: "PRODUCTION_EXECUTION_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: "Posting Eksekusi Produksi",
    body:
      "Input diambil dari workstation pada Tanggal; output didaftarkan sebagai lot dan nilainya — nilai input ditambah " +
      "biaya standar workstation — dibagi menurut Bobot Biaya. Biaya standar dibukukan ke WIP dengan journal di bawah ini. " +
      "Eksekusi yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    journal: true,
    done: "Eksekusi diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "PRODUCTION_EXECUTION_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Eksekusi Produksi",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada barang yang bergerak dan tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Eksekusi ini dibatalkan…",
    done: "Eksekusi dibatalkan",
  },
};

export function executionTransitionAllowed(action: ExecutionAction, status: ExecutionStatus): boolean {
  return EXECUTION_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; posting makes it final. */
export function executionIsEditable(status: ExecutionStatus): boolean {
  return status === "Draft";
}

export type ExecutionAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function executionAbilities(permissions: Iterable<string>): ExecutionAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PRODUCTION_EXECUTION_CREATE"),
    edit: held.has("PRODUCTION_EXECUTION_EDIT"),
    post: held.has("PRODUCTION_EXECUTION_POST"),
    cancel: held.has("PRODUCTION_EXECUTION_CANCEL"),
  };
}

export function availableExecutionActions(status: ExecutionStatus, can: ExecutionAbilities): ExecutionAction[] {
  return EXECUTION_ACTIONS.filter((a) => executionTransitionAllowed(a, status) && can[a]);
}

export const EXECUTION_STATUS_TEXT: Record<ExecutionStatus, string> = { Draft: "Draft", Posted: "Diposting", Cancelled: "Dibatalkan" };

export const EXECUTION_STATUS_BADGE: Record<ExecutionStatus, string> = { Draft: "s-warn", Posted: "s-ok", Cancelled: "s-mute" };
