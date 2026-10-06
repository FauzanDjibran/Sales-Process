/**
 * The AP advance bill's lifecycle (P126, B23) — the AR bill's shape (P57)
 * with the other side's words, as P58 says. Draft → Catat → Diterbitkan;
 * Batalkan with a reason, refused once a posted payment has settled it.
 * It posts nothing at any step.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { AdvanceAbilities, AdvanceAction, AdvanceStatus, AdvanceTransition } from "./ar-advance-workflow";

export { ADVANCE_STATUS_BADGE, ADVANCE_STATUS_TEXT, advanceIsEditable } from "./ar-advance-workflow";
export type { AdvanceAbilities, AdvanceAction, AdvanceStatus } from "./ar-advance-workflow";

export const PURCHASE_ADVANCE_TRANSITIONS: Record<AdvanceAction, AdvanceTransition> = {
  issue: {
    label: "Catat",
    permission: "PURCHASE_ADVANCE_ISSUE",
    from: ["Draft"],
    to: "Issued",
    icon: "send",
    tone: "primary",
    title: "Catat Tagihan Uang Muka Supplier",
    body:
      "Tagihan uang muka dari supplier dikunci dan siap dibayar. Tidak ada journal: kas, " +
      "Uang Muka Pembelian dan PPN Masukan baru dicatat saat dibayar di menu Pengeluaran Kas & Bank.",
    confirmLabel: "Ya, Catat",
    done: "Tagihan uang muka supplier dicatat",
  },
  cancel: {
    label: "Batalkan",
    permission: "PURCHASE_ADVANCE_CANCEL",
    from: ["Draft", "Issued"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Konfirmasi Batalkan Tagihan Uang Muka Supplier",
    body:
      "Tagihan ditandai Dibatalkan dan nilainya kembali menjadi sisa Purchase Order. Tidak ada " +
      "journal yang terpengaruh karena tagihan tidak pernah memposting. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    needsReason: true,
    done: "Tagihan uang muka supplier dibatalkan",
  },
};

export function advanceTransitionAllowed(action: AdvanceAction, status: AdvanceStatus): boolean {
  return PURCHASE_ADVANCE_TRANSITIONS[action].from.includes(status);
}

export function purchaseAdvanceAbilities(permissions: Iterable<string>): AdvanceAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("PURCHASE_ADVANCE_CREATE"),
    edit: held.has("PURCHASE_ADVANCE_EDIT"),
    issue: held.has("PURCHASE_ADVANCE_ISSUE"),
    cancel: held.has("PURCHASE_ADVANCE_CANCEL"),
  };
}

export function availablePurchaseAdvanceActions(status: AdvanceStatus, can: AdvanceAbilities): AdvanceAction[] {
  return (["issue", "cancel"] as AdvanceAction[]).filter((a) => advanceTransitionAllowed(a, status) && can[a]);
}
