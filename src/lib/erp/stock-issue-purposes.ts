/**
 * The purposes of a BSTB Issue — a catalogue in code (Claude-ERP.md P106,
 * R4), like the Delivery Note's.
 *
 * A BSTB Issue is standalone: goods leave a warehouse for a use inside the
 * company, and its purpose says where they go and how Terima books them.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type StockIssuePurposeKey = "production_issue" | "auxiliary_issue";

export type StockIssuePurpose = {
  key: StockIssuePurposeKey;
  /** As the form and the register read it. */
  name: string;
  desc: string;
  /** The goods are placed at a unit (the production ledger). */
  needsUnit: boolean;
  /** Only the first Unit of the routing takes them: the rest arrive by BSTB. */
  firstUnitOnly: boolean;
};

export const STOCK_ISSUE_PURPOSES: readonly StockIssuePurpose[] = [
  {
    key: "production_issue",
    name: "Bahan ke Produksi",
    desc:
      "Bahan keluar dari gudang ke Unit pertama routing, per lot. Lot tetap bernomor sama di produksi; " +
      "Terima memindahkan nilainya dari Persediaan ke WIP.",
    needsUnit: true,
    firstUnitOnly: true,
  },
  {
    key: "auxiliary_issue",
    name: "Bahan Penolong ke Unit",
    desc: "Kotak, gabus, stiker dan sejenisnya masuk ke Unit mana pun yang memakainya, menjadi saldo Unit itu, bukan isi partai.",
    needsUnit: true,
    firstUnitOnly: false,
  },
];

/** The purpose a new issue starts on. */
export const DEFAULT_STOCK_ISSUE_PURPOSE: StockIssuePurposeKey = "production_issue";

export function stockIssuePurpose(key: string): StockIssuePurpose | undefined {
  return STOCK_ISSUE_PURPOSES.find((p) => p.key === key);
}
