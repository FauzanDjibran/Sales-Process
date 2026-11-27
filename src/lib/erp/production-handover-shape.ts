/**
 * The words and paths of goods entering and leaving production, client-safe
 * (P317): the Production Receipt and the Production Issue.
 */
export type HandoverStatus = "InTransit" | "Received";
export const HANDOVER_STATUS_BADGE: Record<HandoverStatus, string> = { InTransit: "s-info", Received: "s-ok" };

export const PRODUCTION_RECEIPT_PATH = "/production/receipt";
export type ProductionReceiptPurpose = "material" | "auxiliary";
export const PRODUCTION_RECEIPT_PURPOSES: Record<ProductionReceiptPurpose, string> = {
  material: "BSTB Issue · Bahan",
  auxiliary: "BSTB Issue · Bahan Penolong",
};
export const PRODUCTION_RECEIPT_STATUS_TEXT: Record<HandoverStatus, string> = { InTransit: "Dalam Perjalanan", Received: "Diterima" };

export const PRODUCTION_ISSUE_PATH = "/production/issue";
/** `finish_goods`: Stand By of the Unit that ends a line, whole (P303). `return`: Persiapan or Stand By of any Unit, in part (P304). */
export type ProductionIssuePurpose = "finish_goods" | "return";
export const PRODUCTION_ISSUE_PURPOSES: Record<ProductionIssuePurpose, { name: string; prefix: string; sendPath: string }> = {
  finish_goods: { name: "BSTB ke Finish Goods", prefix: "BFG", sendPath: "/production/issue/finish-goods" },
  return: { name: "BSTB Pengeluaran", prefix: "BPG", sendPath: "/production/issue/return" },
};
export const issuePurposeOf = (p: string): ProductionIssuePurpose => (p === "return" ? "return" : "finish_goods");
export const PRODUCTION_ISSUE_STATUS_TEXT: Record<HandoverStatus, string> = { InTransit: "Dalam Perjalanan", Received: "Diterima" };

/** Why goods leave by BSTB Pengeluaran: for reading only, every one of them posts the same. */
export const PRODUCTION_ISSUE_REASONS: Record<string, string> = {
  reject: "Reject",
  broken: "Rusak atau pecah",
  leftover: "Sisa produksi",
  auxiliary: "Sisa bahan penolong",
  other: "Lain-lain",
};

/**
 * What a BSTB Pengeluaran's goods are worth when they reach the warehouse,
 * chosen by the Unit at Kirim (P339): no figure, only whether they keep value.
 */
export type ProductionValueMode = "carried" | "none";
export const VALUE_MODE_TEXT: Record<ProductionValueMode, { name: string; help: string }> = {
  carried: { name: "Nilai terbawa", help: "Barang masih bernilai: masuk stok gudang senilai yang dibawanya dari produksi." },
  none: { name: "Tanpa nilai", help: "Barang tidak bernilai lagi: masuk stok bernilai 0 dan nilainya menjadi Beban Pemusnahan Produksi." },
};
export const valueModeOf = (v: unknown): ProductionValueMode => (v === "none" ? "none" : "carried");
