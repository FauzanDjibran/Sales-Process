/**
 * The purposes of a Stock Receipt — a catalogue in code (P106), like the Stock
 * Issue's: goods coming into a warehouse without a partner. Two come from
 * production, made by its Production Issue (P317); the third is what a weighed
 * Receipt Note took in beyond its tolerance, made and received by its posting (P321).
 *
 * Client-safe on purpose — no `server-only`, no database import.
 */
export type StockReceiptPurposeKey = "finish_goods" | "return" | "purchase_bonus";
export type StockReceiptPurpose = {
  name: string;
  desc: string;
  /** Whether the warehouse chooses, at Terima, between the goods' value and none (P304). */
  asksValue: boolean;
  /** Sent by a Unit and waiting for Terima; a bonus comes in at once. */
  fromProduction: boolean;
};
export const STOCK_RECEIPT_PURPOSES: Record<StockReceiptPurposeKey, StockReceiptPurpose> = {
  finish_goods: { name: "BSTB ke Finish Goods", desc: "Barang jadi dari Unit terakhir routing, senilai yang dibawanya.", asksValue: false, fromProduction: true },
  return: { name: "BSTB Pengeluaran", desc: "Barang yang dikeluarkan Unit mana pun, dengan nilai atau tanpa nilai.", asksValue: true, fromProduction: true },
  purchase_bonus: { name: "Bonus Pembelian", desc: "Kelebihan timbangan Receipt Note di atas toleransi, masuk stok bernilai 0.", asksValue: false, fromProduction: false },
};
export const stockReceiptPurposeOf = (p: string): StockReceiptPurposeKey => (p === "return" || p === "purchase_bonus" ? p : "finish_goods");

export const STOCK_RECEIPT_PATH = "/inventory/stock-receipt";
export type StockReceiptStatus = "InTransit" | "Received";
export const STOCK_RECEIPT_STATUS_TEXT: Record<StockReceiptStatus, string> = { InTransit: "Dalam Perjalanan", Received: "Diterima" };
export const STOCK_RECEIPT_STATUS_BADGE: Record<StockReceiptStatus, string> = { InTransit: "s-info", Received: "s-ok" };

/** How a BSTB Pengeluaran's goods come into stock (P304). */
export type ProductionValueMode = "carried" | "none";
export const VALUE_MODE_TEXT: Record<ProductionValueMode, { name: string; help: string }> = {
  carried: { name: "Nilai terbawa", help: "Masuk stok senilai yang dibawanya dari produksi: Persediaan didebit, WIP dikredit." },
  none: { name: "Tanpa nilai", help: "Masuk stok bernilai 0 (menurunkan rata-rata barang itu); nilainya dibebankan ke Beban Pemusnahan Produksi." },
};
