/**
 * The Purchase Order's lifecycle, written once and read by both sides (P124,
 * Purchasing-Concept.md B16) — the Customer Order's shape.
 *
 *   Draft ──submit──> Submitted ──approve──> Open ──close──> Closed
 *     │                   │
 *     └──cancel──> Cancelled   └──reject──> Rejected
 *
 * Ajukan locks the order and writes what it orders onto its Purchase Request
 * lines; Tolak gives that back. Tutup closes an Open order by hand, giving back
 * what was never received; it also closes itself once fully received (step 4).
 * A Purchase Order posts nothing at any step.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type PurchaseOrderStatus = "Draft" | "Submitted" | "Open" | "Closed" | "Cancelled" | "Rejected";

export type PurchaseOrderAction = "submit" | "approve" | "reject" | "cancel" | "close";

export const PURCHASE_ORDER_ACTIONS: PurchaseOrderAction[] = ["cancel", "reject", "close", "submit", "approve"];

/** Barang or Jasa: one table, two menus, as the Purchase Request (B10). */
export type PurchaseOrderKind = "goods" | "service";

export const PURCHASE_ORDER_KINDS: Record<PurchaseOrderKind, { itemType: "Barang" | "Jasa"; name: string; path: string }> = {
  goods: { itemType: "Barang", name: "Purchase Order Barang", path: "/purchasing/order/goods" },
  service: { itemType: "Jasa", name: "Purchase Order Jasa", path: "/purchasing/order/service" },
};

export function purchaseOrderKindOf(itemType: "Barang" | "Jasa"): PurchaseOrderKind {
  return itemType === "Barang" ? "goods" : "service";
}

export type PurchaseOrderTransition = {
  label: string;
  permission: PermissionCode;
  from: PurchaseOrderStatus[];
  to: PurchaseOrderStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderAction, PurchaseOrderTransition> = {
  submit: {
    label: "Ajukan",
    permission: "PURCHASE_ORDER_SUBMIT",
    from: ["Draft"],
    to: "Submitted",
    icon: "send",
    tone: "primary",
    title: "Ajukan Purchase Order",
    body:
      "Pesanan dikunci dan menunggu persetujuan: supplier, Kena PPN, mode harga " +
      "dan seluruh baris tidak dapat diubah lagi. Jumlahnya dicatat sebagai " +
      "sudah dipesan pada Purchase Request. Tidak ada journal yang dibuat.",
    confirmLabel: "Ya, Ajukan",
    done: "Purchase Order diajukan",
  },
  approve: {
    label: "Setujui",
    permission: "PURCHASE_ORDER_APPROVE",
    from: ["Submitted"],
    to: "Open",
    icon: "check",
    tone: "primary",
    title: "Setujui Purchase Order",
    body: "Pesanan menjadi Open: siap dikirim ke supplier, diterima dan ditagihkan uang muka. Tidak ada journal yang dibuat.",
    confirmLabel: "Ya, Setujui",
    done: "Purchase Order disetujui",
  },
  reject: {
    label: "Tolak",
    permission: "PURCHASE_ORDER_APPROVE",
    from: ["Submitted"],
    to: "Rejected",
    icon: "block",
    tone: "danger",
    title: "Tolak Purchase Order",
    body: "Pesanan ditandai Ditolak dan jumlahnya dikembalikan ke Purchase Request. Status ini final.",
    confirmLabel: "Ya, Tolak",
    reason: "Mengapa pesanan ini ditolak…",
    done: "Purchase Order ditolak",
  },
  cancel: {
    label: "Batalkan",
    permission: "PURCHASE_ORDER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Purchase Order",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa pesanan ini dibatalkan…",
    done: "Purchase Order dibatalkan",
  },
  close: {
    label: "Tutup Pesanan",
    permission: "PURCHASE_ORDER_CLOSE",
    from: ["Open"],
    to: "Closed",
    icon: "lock",
    tone: "neutral",
    title: "Tutup Purchase Order",
    body:
      "Pesanan ditutup walaupun belum seluruhnya diterima: jumlah yang belum " +
      "diterima dikembalikan ke Purchase Request dan tidak dapat diterima lagi. " +
      "Status ini final.",
    confirmLabel: "Ya, Tutup",
    reason: "Mengapa pesanan ini ditutup…",
    done: "Purchase Order ditutup",
  },
};

export function purchaseOrderTransitionAllowed(action: PurchaseOrderAction, status: PurchaseOrderStatus): boolean {
  return PURCHASE_ORDER_TRANSITIONS[action].from.includes(status);
}

export function purchaseOrderIsEditable(status: PurchaseOrderStatus): boolean {
  return status === "Draft";
}

export type PurchaseOrderAbilities = {
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  close: boolean;
};

export function purchaseOrderAbilities(permissions: Iterable<string>): PurchaseOrderAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PURCHASE_ORDER_CREATE"),
    edit: held.has("PURCHASE_ORDER_EDIT"),
    submit: held.has("PURCHASE_ORDER_SUBMIT"),
    approve: held.has("PURCHASE_ORDER_APPROVE"),
    reject: held.has("PURCHASE_ORDER_APPROVE"),
    cancel: held.has("PURCHASE_ORDER_CANCEL"),
    close: held.has("PURCHASE_ORDER_CLOSE"),
  };
}

export function availablePurchaseOrderActions(status: PurchaseOrderStatus, can: PurchaseOrderAbilities): PurchaseOrderAction[] {
  return PURCHASE_ORDER_ACTIONS.filter((a) => purchaseOrderTransitionAllowed(a, status) && can[a]);
}

export const PURCHASE_ORDER_STATUS_TEXT: Record<PurchaseOrderStatus, string> = {
  Draft: "Draft",
  Submitted: "Diajukan",
  Open: "Open",
  Closed: "Ditutup",
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
};

export const PURCHASE_ORDER_STATUS_BADGE: Record<PurchaseOrderStatus, string> = {
  Draft: "s-warn",
  Submitted: "s-info",
  Open: "s-ok",
  Closed: "s-mute",
  Cancelled: "s-mute",
  Rejected: "s-bad",
};

export const PURCHASE_ORDER_REASON_TEXT: Partial<Record<PurchaseOrderStatus, string>> = {
  Cancelled: "Dibatalkan",
  Rejected: "Ditolak",
  Closed: "Ditutup",
};

/**
 * Shares a PO line's base quantity over the request lines it covers, earliest
 * Tanggal Dibutuhkan first (B15): each takes up to what it still needs; what is
 * left over belongs to no request. Quantities in ten-thousandths. Client-safe so
 * the form shows the share the save will store.
 */
export function sharePurchaseOrderLine(
  baseQty: number,
  requests: { id: number; neededDate: string; left: number }[]
): { shares: Map<number, number>; excess: number } {
  const u = (n: number) => Math.round(n * 10_000);
  let rest = u(baseQty);
  const shares = new Map<number, number>();
  const order = [...requests].sort((a, b) => a.neededDate.localeCompare(b.neededDate) || a.id - b.id);
  for (const r of order) {
    const take = Math.max(0, Math.min(rest, u(r.left)));
    shares.set(r.id, take / 10_000);
    rest -= take;
  }
  return { shares, excess: rest / 10_000 };
}

/**
 * The PPh rate a Purchase Order withholds (B12): a supplier without an NPWP is
 * withheld at 100 % higher (UU PPh Pasal 23 ayat 1a); a NIK counts as an NPWP
 * for an Orang Pribadi (PMK 112/2022), so any tax identity number will do.
 */
export function purchaseWithholdingRate(rate: number, supplierHasTaxId: boolean): number {
  return supplierHasTaxId ? rate : rate * 2;
}
