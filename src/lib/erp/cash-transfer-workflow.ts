/**
 * Transfer Kas & Bank's purposes, arithmetic and lifecycle (P299,
 * Cash-Bank-Transfer-Plan.md), written once and read by both sides.
 *
 *   Draft ──post──> Posted
 *     │
 *     └──cancel──> Cancelled
 *
 * The purposes are SIBA's (`transfer-catalogue.ts`) without rate layers: the
 * user states what they mean to do and the two resources are checked against
 * it, so picking the wrong account is a refusal rather than a silent currency
 * sale. Each line types the amount in the document currency — the shared one
 * on a Transfer, the foreign side otherwise — and, when the pair crosses, the
 * kurs; the rupiah side is one multiplication (TB4).
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { IconName } from "@/components/icon";
import { BASE_CURRENCY_LABEL } from "./currency";
import { roundBase } from "./fx";
import type { ActionTone } from "./header-actions";
import type { PermissionCode } from "./permissions";

export type CashTransferStatus = "Draft" | "Posted" | "Cancelled";
export type CashTransferAction = "post" | "cancel";
export type CashTransferPurpose = "Transfer" | "Pencairan" | "PembelianValas";

export const CASH_TRANSFER_PATH = "/finance/cash-bank/transfer";

export const CASH_TRANSFER_PURPOSES: { key: CashTransferPurpose; label: string; hint: string }[] = [
  { key: "Transfer", label: "Transfer", hint: "mata uang sama di kedua sisi" },
  { key: "Pencairan", label: "Pencairan Valas", hint: `valuta asing keluar, ${BASE_CURRENCY_LABEL} masuk` },
  { key: "PembelianValas", label: "Pembelian Valas", hint: `${BASE_CURRENCY_LABEL} keluar, valuta asing masuk` },
];

export const CASH_TRANSFER_PURPOSE_TEXT: Record<CashTransferPurpose, string> = {
  Transfer: "Transfer",
  Pencairan: "Pencairan Valas",
  PembelianValas: "Pembelian Valas",
};

/** Whether the pair crosses currencies, so a line types a kurs. */
export const crossesCurrency = (p: CashTransferPurpose) => p !== "Transfer";

/** Why this source cannot carry this purpose, or null when it can. */
export function transferSourceRefusal(purpose: CashTransferPurpose, sourceIsBase: boolean, sourceCurrency: string): string | null {
  if (purpose === "Pencairan" && sourceIsBase) {
    return `Pencairan mencairkan valuta asing menjadi ${BASE_CURRENCY_LABEL}, jadi Kas & Bank asal tidak boleh ${BASE_CURRENCY_LABEL}. Untuk memindahkan ${BASE_CURRENCY_LABEL} antar rekening, pakai Transfer.`;
  }
  if (purpose === "PembelianValas" && !sourceIsBase) {
    return `Pembelian Valas membeli valuta asing memakai ${BASE_CURRENCY_LABEL}, jadi Kas & Bank asal harus ${BASE_CURRENCY_LABEL}, bukan ${sourceCurrency}.`;
  }
  return null;
}

/**
 * Why this destination cannot receive, or null when it can. `docCurrency` is
 * the currency the lines are typed in: the source's on a Transfer or a
 * Pencairan, the first destination's on a Pembelian Valas.
 */
export function transferDestinationRefusal(
  purpose: CashTransferPurpose,
  docCurrency: string,
  destCurrency: string,
  destIsBase: boolean
): string | null {
  if (purpose === "Pencairan") {
    return destIsBase ? null : `Hasil pencairan diterima dalam ${BASE_CURRENCY_LABEL}, jadi Kas & Bank tujuan harus ${BASE_CURRENCY_LABEL}, bukan ${destCurrency}.`;
  }
  if (purpose === "PembelianValas" && destIsBase) {
    return `Pembelian Valas memasukkan valuta asing, jadi Kas & Bank tujuan tidak boleh ${BASE_CURRENCY_LABEL}.`;
  }
  if (docCurrency !== destCurrency) {
    return purpose === "Transfer"
      ? `Transfer memindahkan mata uang yang sama, jadi Kas & Bank tujuan harus ${docCurrency}, bukan ${destCurrency}.`
      : `Valuta yang dibeli dokumen ini ${docCurrency}, jadi Kas & Bank tujuan harus ${docCurrency}, bukan ${destCurrency}.`;
  }
  return null;
}

/**
 * What one line moves: out of the source in its currency and into the
 * destination in its. A Transfer moves the amount itself; a Pencairan sells the
 * amount and brings round(amount × kurs) rupiah; a Pembelian Valas spends
 * round(amount × kurs) rupiah and brings the amount.
 */
export function transferLineAmounts(purpose: CashTransferPurpose, amount: number, rate: number): { outAmount: number; inAmount: number } {
  if (purpose === "Transfer") return { outAmount: amount, inAmount: amount };
  const rupiah = roundBase(amount * rate);
  return purpose === "Pencairan" ? { outAmount: amount, inAmount: rupiah } : { outAmount: rupiah, inAmount: amount };
}

export type CashTransferTransition = {
  label: string;
  permission: PermissionCode;
  from: CashTransferStatus[];
  to: CashTransferStatus;
  icon: IconName;
  tone: ActionTone;
  title: string;
  body: string;
  confirmLabel: string;
  reason?: string;
  done: string;
};

export const CASH_TRANSFER_TRANSITIONS: Record<CashTransferAction, CashTransferTransition> = {
  post: {
    label: "Posting",
    permission: "CASH_TRANSFER_POST",
    from: ["Draft"],
    to: "Posted",
    icon: "send",
    tone: "primary",
    title: "Posting Transfer",
    body:
      "Dana keluar dari Kas & Bank asal dan masuk ke setiap Kas & Bank tujuan pada tanggal dokumen, dan journal di bawah ditulis. " +
      "Valas yang keluar dinilai pada kurs rata-ratanya. Dokumen yang sudah diposting tidak dapat diubah atau dibatalkan.",
    confirmLabel: "Ya, Posting",
    done: "Transfer diposting",
  },
  cancel: {
    label: "Batalkan",
    permission: "CASH_TRANSFER_CANCEL",
    from: ["Draft"],
    to: "Cancelled",
    icon: "block",
    tone: "danger",
    title: "Batalkan Transfer",
    body: "Draft ditandai Dibatalkan dan tidak dapat dipakai lagi. Tidak ada dana yang berpindah. Status ini final.",
    confirmLabel: "Ya, Batalkan",
    reason: "Mengapa transfer ini dibatalkan…",
    done: "Transfer dibatalkan",
  },
};

const ACTIONS: CashTransferAction[] = ["cancel", "post"];

export function cashTransferTransitionAllowed(action: CashTransferAction, status: CashTransferStatus): boolean {
  return CASH_TRANSFER_TRANSITIONS[action].from.includes(status);
}

export function cashTransferIsEditable(status: CashTransferStatus): boolean {
  return status === "Draft";
}

export type CashTransferAbilities = { create: boolean; edit: boolean; post: boolean; cancel: boolean };

export function cashTransferAbilities(permissions: Iterable<string>): CashTransferAbilities {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  return {
    create: held.has("CASH_TRANSFER_CREATE"),
    edit: held.has("CASH_TRANSFER_EDIT"),
    post: held.has("CASH_TRANSFER_POST"),
    cancel: held.has("CASH_TRANSFER_CANCEL"),
  };
}

export function availableCashTransferActions(status: CashTransferStatus, can: CashTransferAbilities): CashTransferAction[] {
  return ACTIONS.filter((a) => cashTransferTransitionAllowed(a, status) && can[a]);
}

export const CASH_TRANSFER_STATUS_TEXT: Record<CashTransferStatus, string> = {
  Draft: "Draft",
  Posted: "Diposting",
  Cancelled: "Dibatalkan",
};

export const CASH_TRANSFER_STATUS_BADGE: Record<CashTransferStatus, string> = {
  Draft: "s-warn",
  Posted: "s-ok",
  Cancelled: "s-mute",
};
