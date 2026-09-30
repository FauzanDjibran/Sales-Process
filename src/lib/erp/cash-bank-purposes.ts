/**
 * The purposes (tujuan) of a cash and bank transaction — a catalogue in code
 * (Claude-ERP.md P66, closing C3's first half).
 *
 * A purpose is behaviour, not data: it decides the direction money moves, the
 * partner it moves with, which documents it may settle and how it posts. One
 * a user could create at runtime would be a row no code knows how to post, so
 * the list lives here, the way the settings catalogue does. The accounts a
 * purpose posts to come from Account Mapping (P61), and the PPh accounts from
 * each Jenis PPh (P44).
 *
 * **Purpose, then partner, decide what one transaction may settle** (P67):
 * only documents of the purpose's kind, owed by that one partner. A receipt
 * that settles several of them is one transfer on the bank statement.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type CashBankDirection = "In" | "Out";

export type CashBankPurposeKey = "sales_advance";

export type CashBankPurpose = {
  key: CashBankPurposeKey;
  direction: CashBankDirection;
  /** The purpose, as the picker and the register read it. */
  name: string;
  /** Shorter, for a tag. */
  short: string;
  desc: string;
  /** The partner category the partner is drawn from (P30). */
  partnerCategory: "Customer" | "Supplier";
  /** The `sys_doc_type.doc_table` of what it settles. */
  settles: "sal_advance";
  /** What one settled document is called on the form. */
  docNoun: string;
  /** Whether the settled documents carry PPh a partner may withhold. */
  withholding: boolean;
};

export const CASH_BANK_PURPOSES = [
  {
    key: "sales_advance",
    direction: "In",
    name: "Penerimaan Uang Muka Penjualan",
    short: "Uang Muka Penjualan",
    desc:
      "Dana dari customer atas tagihan uang muka yang sudah diterbitkan. Kewajiban " +
      "uang muka dan PPN Keluaran tercatat pada tanggal terima.",
    partnerCategory: "Customer",
    settles: "sal_advance",
    docNoun: "Tagihan Uang Muka",
    withholding: true,
  },
] as const satisfies readonly CashBankPurpose[];

export function isCashBankPurposeKey(key: string): key is CashBankPurposeKey {
  return CASH_BANK_PURPOSES.some((p) => p.key === key);
}

export function cashBankPurpose(key: string): CashBankPurpose | null {
  return CASH_BANK_PURPOSES.find((p) => p.key === key) ?? null;
}

export function purposesFor(direction: CashBankDirection): readonly CashBankPurpose[] {
  return CASH_BANK_PURPOSES.filter((p) => p.direction === direction);
}

/** The number series each direction is counted in (P70). */
export const CASH_BANK_PREFIX: Record<CashBankDirection, string> = { In: "BKM", Out: "BKK" };
