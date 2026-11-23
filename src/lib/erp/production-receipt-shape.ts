/** The words and paths of the BSTB from production into a warehouse, client-safe (P303, P304). */
export type ProductionReceiptStatus = "Submitted" | "Posted";
export const PRODUCTION_RECEIPT_STATUS_TEXT: Record<ProductionReceiptStatus, string> = { Submitted: "Diajukan", Posted: "Diterima" };
export const PRODUCTION_RECEIPT_STATUS_BADGE: Record<ProductionReceiptStatus, string> = { Submitted: "s-info", Posted: "s-ok" };

/** `finish_goods`: from the last Unit of a line, Stand By only, whole (P303). `return`: from any Unit's Persiapan or Stand By, in part (P304). */
export type ProductionReceiptPurpose = "finish_goods" | "return";
export const PRODUCTION_RECEIPT_PURPOSES: Record<ProductionReceiptPurpose, { name: string; prefix: string; path: string; sendPath: string }> = {
  finish_goods: { name: "BSTB ke Finish Goods", prefix: "BFG", path: "/inventory/production-receipt", sendPath: "/production/transfer/finish-goods" },
  return: { name: "BSTB Pengeluaran", prefix: "BPG", path: "/inventory/production-return", sendPath: "/production/transfer/return" },
};
export const purposeOf = (p: string): ProductionReceiptPurpose => (p === "return" ? "return" : "finish_goods");
export const PRODUCTION_RECEIPT_PATH = PRODUCTION_RECEIPT_PURPOSES.finish_goods.path;

/** How a BSTB Pengeluaran's goods come into stock (P304). */
export type ProductionValueMode = "carried" | "none";
export const VALUE_MODE_TEXT: Record<ProductionValueMode, { name: string; help: string }> = {
  carried: { name: "Nilai terbawa", help: "Masuk stok senilai yang dibawanya dari produksi: Persediaan didebit, WIP dikredit." },
  none: { name: "Tanpa nilai", help: "Masuk stok bernilai 0 (menurunkan rata-rata barang itu); nilainya dibebankan ke Beban Pemusnahan Produksi." },
};
