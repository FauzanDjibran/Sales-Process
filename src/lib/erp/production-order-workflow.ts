/**
 * The Perintah Produksi's lifecycle, written once and read by both sides
 * (Walet build step 3, `production_project.md` M121).
 *
 *   Draft ──open──> Open ──close──> Closed
 *     │
 *     └──cancel──> Cancelled
 *
 * Buka locks the Perintah and makes it Open, so a Logistik BSTB may be raised
 * from it. Tutup closes it by hand with a reason, refused while a BSTB raised
 * from it is still a Draft or in transit; once its Partai exists (step 4) it
 * will also close itself when nothing of the Partai is left in production.
 * A Perintah posts nothing at any step.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type ProductionOrderStatus = "Draft" | "Open" | "Closed" | "Cancelled";

export type ProductionOrderAction = "open" | "cancel" | "close";

export const PRODUCTION_ORDER_ACTIONS: ProductionOrderAction[] = ["cancel", "close", "open"];

export type ProductionOrderTransition = {
  label: string;
  permission: PermissionCode;
  from: ProductionOrderStatus[];
  to: ProductionOrderStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const PRODUCTION_ORDER_TRANSITIONS: Record<ProductionOrderAction, ProductionOrderTransition> = {
  open: {
    label: "Buka",
    permission: "PRODUCTION_ORDER_OPEN",
    from: ["Draft"],
    to: "Open",
    icon: "send",
    tone: "primary",
    title: "Buka Perintah Produksi",
    body:
      "Perintah dikunci dan menjadi Open: Job Order, rute dan rencana lot tidak dapat diubah lagi, " +
      "dan Logistik dapat mengirim lotnya dengan BSTB. Tidak ada stok yang bergerak dan tidak ada journal.",
    confirmLabel: "Ya, Buka",
    done: "Perintah Produksi dibuka",
  },
  cancel: {
    label: "Batalkan",
    permission: "PRODUCTION_ORDER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Perintah Produksi",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Perintah ini dibatalkan…",
    done: "Perintah Produksi dibatalkan",
  },
  close: {
    label: "Tutup",
    permission: "PRODUCTION_ORDER_CLOSE",
    from: ["Open"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Perintah Produksi",
    body:
      "Perintah ditutup: tidak ada BSTB baru yang dapat dibuat darinya. Barang yang sudah dikirim " +
      "tetap di produksi. Ditolak selama masih ada BSTB Draft atau yang belum diterima. Status ini final.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa Perintah ini ditutup…",
    done: "Perintah Produksi ditutup",
  },
};

export function productionOrderTransitionAllowed(action: ProductionOrderAction, status: ProductionOrderStatus): boolean {
  return PRODUCTION_ORDER_TRANSITIONS[action].from.includes(status);
}

/** Only a Draft can be edited; Buka locks it. */
export function productionOrderIsEditable(status: ProductionOrderStatus): boolean {
  return status === "Draft";
}

export type ProductionOrderAbilities = {
  create: boolean;
  edit: boolean;
  open: boolean;
  cancel: boolean;
  close: boolean;
};

export function productionOrderAbilities(permissions: Iterable<string>): ProductionOrderAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PRODUCTION_ORDER_CREATE"),
    edit: held.has("PRODUCTION_ORDER_EDIT"),
    open: held.has("PRODUCTION_ORDER_OPEN"),
    cancel: held.has("PRODUCTION_ORDER_CANCEL"),
    close: held.has("PRODUCTION_ORDER_CLOSE"),
  };
}

export function availableProductionOrderActions(status: ProductionOrderStatus, can: ProductionOrderAbilities): ProductionOrderAction[] {
  return PRODUCTION_ORDER_ACTIONS.filter((a) => productionOrderTransitionAllowed(a, status) && can[a]);
}

export const PRODUCTION_ORDER_STATUS_TEXT: Record<ProductionOrderStatus, string> = {
  Draft: "Draft",
  Open: "Open",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
};

export const PRODUCTION_ORDER_STATUS_BADGE: Record<ProductionOrderStatus, string> = {
  Draft: "s-warn",
  Open: "s-ok",
  Closed: "s-mute",
  Cancelled: "s-mute",
};

export const PRODUCTION_ORDER_REASON_TEXT: Partial<Record<ProductionOrderStatus, string>> = {
  Cancelled: "Dibatalkan",
  Closed: "Ditutup",
};
