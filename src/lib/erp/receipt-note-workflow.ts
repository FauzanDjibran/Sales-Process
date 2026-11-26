/**
 * The Receipt Note's lifecycle and its arithmetic, written once and read by
 * both sides (P125, Purchasing-Concept.md B17–B22).
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * Posting brings Kelola Stok lines into the stock books by lot and books every
 * line at its share of the Purchase Order's DPP: Dr Persediaan / Beban, Cr
 * Barang Diterima Belum Ditagih. A posted note is final; there is no
 * correction of our own documents (B33).
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type ReceiptNoteStatus = "Draft" | "Posted" | "Cancelled";
export type ReceiptNoteAction = "post" | "cancel";
export const RECEIPT_NOTE_ACTIONS: ReceiptNoteAction[] = ["cancel", "post"];

/** The one purpose so far (P106): goods or a service received against a Purchase Order. */
export const PURCHASE_RECEIPT = "purchase_receipt";

/** Goods a customer sends back, against an Open Sales Return (P288). */
export const SALES_RETURN = "sales_return";

/** What posting a return does, for its confirmation in place of the purchase wording. */
export const SALES_RETURN_POST_BODY =
  "Barang masuk kembali ke gudang per lot pada Tanggal Terima, dengan status yang dipilih, senilai saat barang " +
  "keluar, sehingga HPP dibalik dengan journal di bawah ini. Penjualan, PPN dan piutang belum dikoreksi — itu " +
  "dilakukan Credit Note bila barangnya sudah ditagih. Receipt Note yang sudah diposting tidak dapat diubah atau dibatalkan.";

export type ReceiptNoteTransition = {
  label: string;
  permission: PermissionCode;
  from: ReceiptNoteStatus[];
  to: ReceiptNoteStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const RECEIPT_NOTE_TRANSITIONS: Record<ReceiptNoteAction, ReceiptNoteTransition> = {
  post: {
    label: "Posting",
    permission: "RECEIPT_NOTE_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "box",
    tone: "primary",
    title: "Posting Receipt Note",
    body:
      "Barang dengan Kelola Stok masuk ke gudang per lot pada Tanggal Terima; barang lain dan jasa " +
      "dibebankan. Nilainya bagian DPP Purchase Order, dengan journal di bawah ini. Hutang belum " +
      "diakui — itu terjadi saat Invoice Pembelian diposting. Receipt Note yang sudah diposting " +
      "tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Receipt Note diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "RECEIPT_NOTE_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Receipt Note",
    body: "Draft ditandai Dibatalkan; jumlahnya kembali menjadi sisa Purchase Order. Tidak ada journal yang dibuat. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa Receipt Note ini dibatalkan…",
    done: "Receipt Note dibatalkan",
  },
};

export function receiptNoteTransitionAllowed(action: ReceiptNoteAction, status: ReceiptNoteStatus): boolean {
  return RECEIPT_NOTE_TRANSITIONS[action].from.includes(status);
}

export function receiptNoteIsEditable(status: ReceiptNoteStatus): boolean {
  return status === "Draft";
}

/** A Draft holds its quantity as a posted note does, so two notes cannot over-receive a line. */
export const RECEIPT_NOTE_HOLDS_QTY: ReceiptNoteStatus[] = ["Draft", "Posted"];

export type ReceiptNoteAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function receiptNoteAbilities(permissions: Iterable<string>): ReceiptNoteAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("RECEIPT_NOTE_CREATE"),
    edit: held.has("RECEIPT_NOTE_EDIT"),
    post: held.has("RECEIPT_NOTE_POST"),
    cancel: held.has("RECEIPT_NOTE_CANCEL"),
  };
}

export function availableReceiptNoteActions(status: ReceiptNoteStatus, can: ReceiptNoteAbilities): ReceiptNoteAction[] {
  return RECEIPT_NOTE_ACTIONS.filter((a) => receiptNoteTransitionAllowed(a, status) && can[a]);
}

export const RECEIPT_NOTE_STATUS_TEXT: Record<ReceiptNoteStatus, string> = { Draft: "Draft", Posted: "Diposting", Cancelled: "Dibatalkan" };
export const RECEIPT_NOTE_STATUS_BADGE: Record<ReceiptNoteStatus, string> = { Draft: "s-warn", Posted: "s-ok", Cancelled: "s-mute" };

/** Millionths: a received quantity may carry six decimals (P320). */
const U = 1_000_000;
const u = (n: number) => Math.round(n * U);

/**
 * A quantity's share of an amount, cumulative (B20, P112, `tax_concept.md`
 * §7.5): the amount for everything up to and including this quantity, rounded
 * once, less the amount for what came before. So the receipts of one PO line
 * add up to its DPP exactly, and never drift by more than Rp1 on the way.
 */
export function cumulativeShare(amount: number, total: number, before: number, qty: number, scale = 1): number {
  const t = u(total);
  if (t <= 0) return 0;
  // `scale` rounds to a currency's minor unit (MC5): 100 keeps the cents of a USD DPP.
  const upTo = (q: number) => Math.round((amount * scale * Math.min(u(q), t)) / t);
  return (upTo(before + qty) - upTo(before)) / scale;
}

/**
 * Each lot's base quantity (P338), from its quantity in the line's unit: the
 * line's base quantity shared cumulatively at four decimals, so lots that add
 * up to the line's quantity add up to its base quantity exactly. The unit's
 * factor is not used: a weighed or rest-taking line has its own ratio.
 */
export function lotBaseQtys(lineQty: number, lineBaseQty: number, lotQtys: number[]): number[] {
  let before = 0;
  return lotQtys.map((qty) => {
    const base = cumulativeShare(lineBaseQty, lineQty, before / U, qty, 10_000);
    before += u(qty);
    return base;
  });
}

type Receivable ={ qty: number; held: number; uomFactor: number; baseQty: number; heldBase: number };

/**
 * Whether receiving `qty` (the PO line's unit) takes all the line has left, in
 * its own unit or in base units (P320). Such a receipt takes the rest of both,
 * so no sliver of either stays behind. Client-safe: the form shows what the
 * save will store.
 */
export function receivesRest(qty: number, line: Receivable): boolean {
  return u(qty) >= u(line.qty - line.held) || Math.round(qty * line.uomFactor * 10_000) >= Math.round((line.baseQty - line.heldBase) * 10_000);
}

/** What receiving `qty` of a PO line is in base units. */
export function receivedBaseQty(qty: number, line: Receivable): number {
  return Math.round((receivesRest(qty, line) ? line.baseQty - line.heldBase : qty * line.uomFactor) * 10_000) / 10_000;
}
