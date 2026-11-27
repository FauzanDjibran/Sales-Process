/**
 * The purposes of a Stock Receipt — a catalogue in code (P106), like the Stock
 * Issue's: goods coming into a warehouse without a partner. The warehouse makes
 * every one with Buat (P339); the purpose says what it is made from and **how
 * its value is found** (SR-7), so nobody on the form chooses whether goods keep
 * value:
 *
 * - `source` — the value the source froze. From production that is the Unit's
 *   choice at Kirim: carried, or none (the goods come in at 0, their value to
 *   Beban Pemusnahan Produksi).
 * - `zero` — always 0, no journal (a bonus the supplier does not bill).
 * - `typed` — typed per No. Stok (a receipt with no source).
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
import type { ProductionValueMode } from "./production-handover-shape";

export type StockReceiptPurposeKey = "finish_goods" | "return" | "purchase_bonus" | "other_receipt";
export type StockReceiptValueRule = "source" | "zero" | "typed";
export type StockReceiptPurpose = {
  key: StockReceiptPurposeKey;
  name: string;
  desc: string;
  valueRule: StockReceiptValueRule;
  /** What it is made from: a shipment of production, a Receipt Note's bonus, or nothing. */
  source: "production" | "receipt_note" | null;
  /** The note is required, and is called this. */
  noteLabel?: string;
};

export const STOCK_RECEIPT_PURPOSES: Record<StockReceiptPurposeKey, StockReceiptPurpose> = {
  finish_goods: { key: "finish_goods", name: "BSTB ke Finish Goods", desc: "Barang jadi yang dikirim Unit terakhir routing, senilai yang dibawanya.", valueRule: "source", source: "production" },
  return: { key: "return", name: "BSTB Pengeluaran", desc: "Barang yang dikeluarkan Unit mana pun, bernilai atau tanpa nilai menurut pilihan Unit saat Kirim.", valueRule: "source", source: "production" },
  purchase_bonus: { key: "purchase_bonus", name: "Bonus Pembelian", desc: "Kelebihan timbangan Receipt Note di atas toleransi: masuk stok bernilai 0, tanpa journal.", valueRule: "zero", source: "receipt_note" },
  other_receipt: {
    key: "other_receipt",
    name: "Penerimaan Lain-lain",
    desc: "Barang masuk tanpa dokumen sumber, dengan nilai yang diketik: Persediaan didebit, Penerimaan Persediaan Lain-lain dikredit.",
    valueRule: "typed",
    source: null,
    noteLabel: "Alasan",
  },
};
export const STOCK_RECEIPT_PURPOSE_KEYS = Object.keys(STOCK_RECEIPT_PURPOSES) as StockReceiptPurposeKey[];
export const isStockReceiptPurpose = (p: unknown): p is StockReceiptPurposeKey => typeof p === "string" && p in STOCK_RECEIPT_PURPOSES;
export const stockReceiptPurposeOf = (p: string): StockReceiptPurposeKey => (isStockReceiptPurpose(p) ? p : "finish_goods");

export const STOCK_RECEIPT_PATH = "/inventory/stock-receipt";

export { VALUE_MODE_TEXT, type ProductionValueMode } from "./production-handover-shape";

/** What one production shipment's value is, read by the receipt that takes it. */
export const takesValue = (mode: ProductionValueMode | null | undefined) => mode !== "none";
