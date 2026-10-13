/**
 * The purposes of a Stock Issue — a catalogue in code (Claude-ERP.md P106,
 * P158), like the Delivery Note's.
 *
 * A Stock Issue is standalone: goods leave a warehouse for a use inside the
 * company, and its purpose says where they go and how Post books them. The
 * first is material into production; the issue of consumables expensed at once
 * to a Jenis Biaya with its Cost Center (M80) will be the second.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type StockIssuePurposeKey = "production_issue";

export type StockIssuePurpose = {
  key: StockIssuePurposeKey;
  /** As the form and the register read it. */
  name: string;
  desc: string;
  /** The goods are placed at a workstation (the production ledger). */
  needsWorkstation: boolean;
};

export const STOCK_ISSUE_PURPOSES: readonly StockIssuePurpose[] = [
  {
    key: "production_issue",
    name: "Pengeluaran ke Produksi",
    desc:
      "Bahan keluar dari gudang ke sebuah Workstation, per lot. Lot tetap bernomor sama di produksi; " +
      "Posting memindahkan nilainya dari Persediaan ke WIP.",
    needsWorkstation: true,
  },
];

/** The purpose a new issue starts on — the only one so far. */
export const DEFAULT_STOCK_ISSUE_PURPOSE: StockIssuePurposeKey = "production_issue";

export function stockIssuePurpose(key: string): StockIssuePurpose | undefined {
  return STOCK_ISSUE_PURPOSES.find((p) => p.key === key);
}
