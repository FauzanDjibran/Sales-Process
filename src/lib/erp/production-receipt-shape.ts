/** The words and path of BSTB ke Finish Goods, client-safe (P303). */
export type ProductionReceiptStatus = "Submitted" | "Posted";
export const PRODUCTION_RECEIPT_STATUS_TEXT: Record<ProductionReceiptStatus, string> = { Submitted: "Diajukan", Posted: "Diterima" };
export const PRODUCTION_RECEIPT_PATH = "/inventory/production-receipt";
export const PRODUCTION_RECEIPT_STATUS_BADGE: Record<ProductionReceiptStatus, string> = { Submitted: "s-info", Posted: "s-ok" };
