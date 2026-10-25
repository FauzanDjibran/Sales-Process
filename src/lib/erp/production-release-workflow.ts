/**
 * What takes goods out of production (Walet step 6, P170, M118) — one document
 * table by **purpose** (P106), written once and read by both sides:
 *
 * - **`finished_receipt` — Penerimaan Hasil Produksi**: goods go from a
 *   workstation into a warehouse **with their lot kept**, at the value they hold
 *   then (a Turunan at its current value, a BJL or a Reject at 0): journal
 *   Dr Persediaan / Cr WIP.
 * - **`scrap` — Pemusnahan Produksi**: goods are written off, with a reason:
 *   Dr Beban Pemusnahan Produksi / Cr WIP.
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting takes each line out of its production bucket (round(V × q ÷ Q), V whole
 * when it empties) and writes the journal in the same transaction; a posted
 * document is final. When the last goods of a Partai leave, its Perintah closes
 * itself. Batalkan is for a Draft only, with a reason.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";
import type { ExecutionStatus } from "./production-run-workflow";

export type ReleaseStatus = ExecutionStatus;
export type ReleasePurpose = "finished_receipt" | "scrap";
export type ReleaseAction = "post" | "cancel";

export const RELEASE_ACTIONS: ReleaseAction[] = ["cancel", "post"];

export type ReleasePurposeDef = {
  key: ReleasePurpose;
  name: string;
  /** The prefix of its number: `PHP_<unit>_<DDMMYY>_<NNNNN>`. */
  prefix: string;
  /** The route its menu opens. */
  path: string;
  permissionBase: "PRODUCTION_RECEIPT" | "PRODUCTION_SCRAP";
  icon: IconName;
  /** A receipt names the warehouse it goes into. */
  needsWarehouse: boolean;
  /** A scrap says why. */
  needsReason: boolean;
  journalText: string;
  lead: string;
};

export const RELEASE_PURPOSES: Record<ReleasePurpose, ReleasePurposeDef> = {
  finished_receipt: {
    key: "finished_receipt",
    name: "Penerimaan Hasil Produksi",
    prefix: "PHP",
    path: "/production/receipt",
    permissionBase: "PRODUCTION_RECEIPT",
    icon: "box",
    needsWarehouse: true,
    needsReason: false,
    journalText: "Dr Persediaan / Cr WIP",
    lead: "Barang jadi, turunan atau BJL keluar dari Workstation ke gudang dengan nomor lot yang sama, senilai yang dikandungnya saat itu.",
  },
  scrap: {
    key: "scrap",
    name: "Pemusnahan Produksi",
    prefix: "PMS",
    path: "/production/scrap",
    permissionBase: "PRODUCTION_SCRAP",
    icon: "trash",
    needsWarehouse: false,
    needsReason: true,
    journalText: "Dr Beban Pemusnahan Produksi / Cr WIP",
    lead: "Barang di produksi dimusnahkan dengan alasan; nilainya menjadi beban.",
  },
};

export const RELEASE_PURPOSE_KEYS = Object.keys(RELEASE_PURPOSES) as ReleasePurpose[];

export function releasePurpose(key: string | null | undefined): ReleasePurposeDef | null {
  return key && key in RELEASE_PURPOSES ? RELEASE_PURPOSES[key as ReleasePurpose] : null;
}

export type ReleaseTransition = {
  label: string;
  from: ReleaseStatus[];
  to: ReleaseStatus;
  icon: IconName;
  tone: ActionTone;
  title: (p: ReleasePurposeDef) => string;
  body: (p: ReleasePurposeDef) => string;
  confirmLabel: string;
  reason?: string;
  /** The step writes a journal, shown by a dry run in its confirmation (P103). */
  journal?: boolean;
  done: (p: ReleasePurposeDef) => string;
};

export const RELEASE_TRANSITIONS: Record<ReleaseAction, ReleaseTransition> = {
  post: {
    label: "Posting",
    from: ["Draft"],
    to: "Posted",
    icon: "check",
    tone: "primary",
    title: (p) => `Posting ${p.name}`,
    body: (p) =>
      p.needsWarehouse
        ? "Barang diambil dari Workstation pada Tanggal dan dicatat masuk gudang dengan lot yang sama, senilai yang dikandungnya. " +
          "Nilainya dipindahkan dari WIP ke Persediaan dengan journal di bawah ini. Dokumen yang sudah diposting tidak dapat diubah atau dibatalkan."
        : "Barang diambil dari Workstation pada Tanggal dan dimusnahkan; nilainya dipindahkan dari WIP ke beban dengan journal di bawah ini. " +
          "Dokumen yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    journal: true,
    done: (p) => `${p.name} diposting`,
  },
  cancel: {
    label: "Batalkan",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: (p) => `Batalkan ${p.name}`,
    body: () => "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada barang yang bergerak dan tidak ada journal. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa dokumen ini dibatalkan…",
    done: (p) => `${p.name} dibatalkan`,
  },
};

/** The permission a step of a purpose asks for. */
export function releasePermission(purpose: ReleasePurpose, action: ReleaseAction | "view" | "create" | "edit"): PermissionCode {
  return `${RELEASE_PURPOSES[purpose].permissionBase}_${action === "post" ? "POST" : action === "cancel" ? "CANCEL" : action.toUpperCase()}` as PermissionCode;
}

export function releaseTransitionAllowed(action: ReleaseAction, status: ReleaseStatus): boolean {
  return RELEASE_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; posting makes it final. */
export function releaseIsEditable(status: ReleaseStatus): boolean {
  return status === "Draft";
}

export type ReleaseAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function releaseAbilities(purpose: ReleasePurpose, permissions: Iterable<string>): ReleaseAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has(releasePermission(purpose, "create")),
    edit: held.has(releasePermission(purpose, "edit")),
    post: held.has(releasePermission(purpose, "post")),
    cancel: held.has(releasePermission(purpose, "cancel")),
  };
}

export function availableReleaseActions(status: ReleaseStatus, can: ReleaseAbilities): ReleaseAction[] {
  return RELEASE_ACTIONS.filter((a) => releaseTransitionAllowed(a, status) && can[a]);
}

export const RELEASE_STATUS_TEXT: Record<ReleaseStatus, string> = { Draft: "Draft", Posted: "Diposting", Cancelled: "Dibatalkan" };

export const RELEASE_STATUS_BADGE: Record<ReleaseStatus, string> = { Draft: "s-warn", Posted: "s-ok", Cancelled: "s-mute" };
