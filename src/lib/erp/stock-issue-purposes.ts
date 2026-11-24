/**
 * The purposes of a Stock Issue — a catalogue in code (Claude-ERP.md P106,
 * R4), like the Delivery Note's.
 *
 * A Stock Issue is standalone: goods leave a warehouse for a use inside the
 * company, and its purpose says where they go and how Kirim books them.
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */

export type StockIssuePurposeKey = "production_issue" | "auxiliary_issue" | "disposal" | "sample";

export type StockIssuePurpose = {
  key: StockIssuePurposeKey;
  /** As the form and the register read it. */
  name: string;
  desc: string;
  /**
   * The goods go to a Unit, which takes them in (Kirim, then Terima). Without a
   * Unit nobody receives them: Posting ends the document (P323).
   */
  needsUnit: boolean;
  /** Only the first Unit of the routing takes them: the rest arrive by BSTB. */
  firstUnitOnly: boolean;
  /** Without a Unit: the Account Mapping key the goods' value is charged to. */
  expenseAccount?: "stock_disposal_account" | "stock_sample_account";
  /** The note is required, and is called this. */
  noteLabel?: string;
};

export const STOCK_ISSUE_PURPOSES: readonly StockIssuePurpose[] = [
  {
    key: "production_issue",
    name: "BSTB Issue · Bahan ke Produksi",
    desc:
      "Bahan keluar dari gudang ke Unit pertama routing, per lot. Lot tetap bernomor sama di produksi; " +
      "Kirim memindahkan nilainya dari Persediaan ke WIP.",
    needsUnit: true,
    firstUnitOnly: true,
  },
  {
    key: "auxiliary_issue",
    name: "BSTB Issue · Bahan Penolong",
    desc: "Kotak, gabus, stiker dan sejenisnya masuk ke Unit mana pun yang memakainya, menjadi saldo Unit itu, bukan isi partai.",
    needsUnit: true,
    firstUnitOnly: false,
  },
  {
    key: "disposal",
    name: "Pemusnahan",
    desc: "Barang rusak, kadaluarsa atau tidak layak dikeluarkan untuk dimusnahkan; nilainya menjadi beban.",
    needsUnit: false,
    firstUnitOnly: false,
    expenseAccount: "stock_disposal_account",
    noteLabel: "Alasan Pemusnahan",
  },
  {
    key: "sample",
    name: "Pengambilan Sampel",
    desc: "Barang diambil untuk uji atau contoh dan tidak kembali ke stok; nilainya menjadi beban.",
    needsUnit: false,
    firstUnitOnly: false,
    expenseAccount: "stock_sample_account",
    noteLabel: "Keperluan Sampel",
  },
];

/** The purpose a new issue starts on. */
export const DEFAULT_STOCK_ISSUE_PURPOSE: StockIssuePurposeKey = "production_issue";

export function stockIssuePurpose(key: string): StockIssuePurpose | undefined {
  return STOCK_ISSUE_PURPOSES.find((p) => p.key === key);
}
