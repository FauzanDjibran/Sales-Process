/**
 * The words and the path of Push and BSTB, client-safe: the forms and lists read
 * them without importing the database module (P277).
 */
export type TransferKind = "Push" | "Bstb" | "BstbPartai";
export const TRANSFER_KIND_TEXT: Record<TransferKind, string> = { Push: "Dokumen Push", Bstb: "BSTB Transfer", BstbPartai: "BSTB Penyebaran" };
export type TransferStatus = "Submitted" | "Posted";
export const TRANSFER_STATUS_TEXT: Record<TransferStatus, string> = { Submitted: "Diajukan", Posted: "Diterima" };
export const TRANSFER_PATH = "/production/transfer";
