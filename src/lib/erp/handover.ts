import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * The contract between the ERP and Produksi for goods crossing between them
 * (P317, `Goods-Movement-Plan.md` §7). Each side writes only its own documents
 * and books and tells the other by one of these messages; a message names
 * things by number and code, never by id, so it still reads when the two sides
 * have a database each.
 *
 * The sender's document freezes the value; the receiver never works it out
 * again. A receiver takes a message once: the same one again changes nothing.
 *
 * shortcut: one database, so a message is delivered inside the sender's own
 * transaction; with two it becomes an outbox row here and an inbox there.
 */

/** One No. Stok of a message: quantity in the item's base unit, value in whole rupiah. */
export type HandoverLine = {
  trackingNo: string;
  itemCode: string;
  qty: string;
  value: number;
  /** YYYY-MM-DD. */
  expiry: string | null;
  grams: string | null;
  /** Production's identities, as printed. */
  jobNo: string | null;
  partaiNo: string | null;
};

export type HandoverMessage =
  | { type: "IssueSent"; no: string; purpose: "material" | "auxiliary"; date: string; unitLabel: string; warehouseCode: string; warehouseName: string; note: string | null; lines: HandoverLine[] }
  | { type: "IssueReceived"; no: string; date: string }
  | { type: "ReceiptSent"; no: string; purpose: "finish_goods" | "return"; date: string; unitLabel: string; warehouseCode: string; note: string | null; lines: HandoverLine[] }
  | { type: "ReceiptReceived"; no: string; date: string };

/** A message the other side cannot take; the sender's posting is refused with it. */
export class HandoverRefusal extends Error {}

/** Loaded on delivery: the two sides must not import each other. */
export async function deliver(tx: Prisma.TransactionClient, m: HandoverMessage, actorId: number): Promise<void> {
  switch (m.type) {
    case "IssueSent":
      return (await import("./production-receipt")).takeIssueSent(tx, m, actorId);
    case "IssueReceived":
      return (await import("./stock-issue")).takeIssueReceived(tx, m, actorId);
    case "ReceiptSent":
      return (await import("./stock-receipt")).takeReceiptSent(tx, m, actorId);
    case "ReceiptReceived":
      return (await import("./production-issue")).takeReceiptReceived(tx, m, actorId);
  }
}
