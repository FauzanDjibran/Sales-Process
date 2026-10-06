import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";

/**
 * AP items and Buku Hutang (P127, Purchasing-Concept.md B32) — the AR items
 * (`ar-item.ts`, P71–P75, P116–P117) mirrored on the supplier's side.
 *
 * An **Uang Muka** item is born by a posted payment of an AP advance bill, at
 * the DPP paid; an **Invoice** item by a posted Invoice Pembelian, at its face.
 * **Buku Hutang** is every change to an item's balance, append-only; the item's
 * `current_balance` is the sum of its entries, written in the same transaction.
 * A payment lowers an Invoice item directly; an Invoice uses its own PO's Uang
 * Muka at its posting. An item never goes below zero.
 *
 * **It is a book**: kernel imports only. Documents call it inside their
 * posting transaction; it never reaches back to them.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type ApItemType = "Advance" | "Invoice";
export type ApEvent = "Create" | "Payment" | "AdvanceUsed" | "AdvanceApplied";

export const AP_TYPE_TEXT: Record<ApItemType, string> = { Advance: "Uang Muka", Invoice: "Invoice" };
export const AP_EVENT_TEXT: Record<ApEvent, string> = {
  Create: "Terbentuk",
  Payment: "Pembayaran",
  AdvanceUsed: "Dipakai Invoice",
  AdvanceApplied: "Uang Muka Diterapkan",
};

/** Which way an item moves Hutang Usaha: an Invoice raises it, an Uang Muka lowers it. */
export const AP_SIGN: Record<ApItemType, 1 | -1> = { Invoice: 1, Advance: -1 };

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const cents = (n: number) => Math.round(n * 100);

export type NewApItem = {
  type: ApItemType;
  partnerId: number;
  currencyId: number;
  date: string;
  dueDate?: string | null;
  source: { docTypeId: number; docId: number; no: string };
  createdBy: { docTypeId: number; docId: number; no: string };
  orderId?: number | null;
  amount: number;
  note?: string | null;
  actorId: number;
};

/** One ledger number per posting, a line per entry (P110): `BH/YYYY/MM/NNNN`. */
async function ledgerPosition(db: Db, date: Date, docTypeId: number, docId: number): Promise<{ ledger_no: string; line_no: number }> {
  const last = await db.finApLedger.findFirst({ where: { doc_type_id: docTypeId, doc_id: docId }, orderBy: { line_no: "desc" }, select: { ledger_no: true, line_no: true } });
  if (last) return { ledger_no: last.ledger_no, line_no: last.line_no + 1 };
  const ledger_no = await nextDocumentNumber("BH", date, async (series) => {
    const row = await db.finApLedger.findFirst({ where: { ledger_no: { startsWith: series }, line_no: 1 }, orderBy: { id: "desc" }, select: { ledger_no: true } });
    return row?.ledger_no ?? null;
  });
  return { ledger_no, line_no: 1 };
}

/** Creates an item and its Create entry, inside the caller's transaction. */
export async function createApItem(db: Db, item: NewApItem): Promise<number> {
  if (!(item.amount > 0)) throw new Error(`Nilai AP item harus lebih besar dari nol (diterima ${item.amount}).`);
  const date = asDate(item.date);
  const no = await nextDocumentNumber("API", date, async (series) => {
    const last = await db.finApItem.findFirst({ where: { ap_item_no: { startsWith: series } }, orderBy: { ap_item_no: "desc" }, select: { ap_item_no: true } });
    return last?.ap_item_no ?? null;
  });
  const row = await db.finApItem.create({
    data: {
      ap_item_no: no,
      item_type: item.type,
      direction: AP_SIGN[item.type] > 0 ? "Increase" : "Decrease",
      partner_id: item.partnerId,
      currency_id: item.currencyId,
      item_date: date,
      due_date: item.dueDate ? asDate(item.dueDate) : null,
      source_doc_type_id: item.source.docTypeId,
      source_doc_id: item.source.docId,
      source_no: item.source.no,
      purchase_order_id: item.orderId ?? null,
      current_balance: item.amount,
      original_amount: item.amount,
      created_by: item.actorId,
    },
    select: { id: true },
  });
  await db.finApLedger.create({
    data: {
      ...(await ledgerPosition(db, date, item.createdBy.docTypeId, item.createdBy.docId)),
      item_id: row.id,
      event: "Create",
      entry_date: date,
      amount: item.amount,
      movement: item.amount,
      balance_after: item.amount,
      doc_type_id: item.createdBy.docTypeId,
      doc_id: item.createdBy.docId,
      doc_no: item.createdBy.no,
      note: item.note ?? null,
      created_by: item.actorId,
    },
  });
  return row.id;
}

export class ApItemOverdrawn extends Error {
  constructor(readonly itemId: number, readonly balance: number, readonly requested: number) {
    super(`Sisa AP item tidak mencukupi: tersisa ${balance}, diminta ${requested}. Posting dibatalkan.`);
    this.name = "ApItemOverdrawn";
  }
}

/** Lowers an item's balance with the row locked, and writes the entry. */
export async function settleApItem(
  db: Prisma.TransactionClient,
  move: {
    itemId: number;
    event: Exclude<ApEvent, "Create">;
    amount: number;
    date: string;
    doc: { docTypeId: number; docId: number; no: string };
    counterItemId?: number | null;
    note?: string | null;
    actorId: number;
  }
): Promise<void> {
  if (!(move.amount > 0)) throw new Error("Nilai penyelesaian AP item harus lebih besar dari nol.");
  await db.$queryRaw`SELECT id FROM fin_ap_item WHERE id = ${move.itemId} FOR UPDATE`;
  const item = await db.finApItem.findUniqueOrThrow({ where: { id: move.itemId }, select: { current_balance: true } });
  const balance = item.current_balance.toNumber();
  if (cents(move.amount) > cents(balance)) throw new ApItemOverdrawn(move.itemId, balance, move.amount);
  const after = (cents(balance) - cents(move.amount)) / 100;
  await db.finApItem.update({ where: { id: move.itemId }, data: { current_balance: after } });
  await db.finApLedger.create({
    data: {
      ...(await ledgerPosition(db, asDate(move.date), move.doc.docTypeId, move.doc.docId)),
      item_id: move.itemId,
      event: move.event,
      entry_date: asDate(move.date),
      amount: move.amount,
      movement: -move.amount,
      balance_after: after,
      doc_type_id: move.doc.docTypeId,
      doc_id: move.doc.docId,
      doc_no: move.doc.no,
      counter_item_id: move.counterItemId ?? null,
      note: move.note ?? null,
      created_by: move.actorId,
    },
  });
}

/** Items' balances now, by id. */
export async function apItemBalances(ids: number[], db: Db = prisma): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const rows = await db.finApItem.findMany({ where: { id: { in: ids } }, select: { id: true, current_balance: true } });
  return new Map(rows.map((r) => [r.id, r.current_balance.toNumber()]));
}

/** The Invoice items with something still to pay, as ids. */
export async function openApInvoiceItemIds(db: Db = prisma): Promise<number[]> {
  const rows = await db.finApItem.findMany({ where: { item_type: "Invoice", current_balance: { gt: 0 } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function lockApItems(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) await tx.$queryRaw`SELECT id FROM fin_ap_item WHERE id = ${id} FOR UPDATE`;
}

/** An Uang Muka item as an Invoice Pembelian picks it. */
export type ApAdvanceItem = {
  id: number;
  apItemNo: string;
  date: string;
  partnerId: number;
  orderId: number | null;
  sourceNo: string;
  sourceId: number;
  createdByNo: string;
  balance: number;
  original: number;
};

export async function apAdvanceItems(filter: { orderIds?: number[]; ids?: number[] }, db: Db = prisma): Promise<ApAdvanceItem[]> {
  const rows = await db.finApItem.findMany({
    where: {
      item_type: "Advance",
      ...(filter.ids ? { id: { in: filter.ids } } : { purchase_order_id: { in: filter.orderIds ?? [] }, current_balance: { gt: 0 } }),
    },
    include: { entries: { where: { event: "Create" }, select: { doc_no: true } } },
    orderBy: [{ item_date: "asc" }, { id: "asc" }],
  });
  return rows.map((i) => ({
    id: i.id,
    apItemNo: i.ap_item_no,
    date: isoDay(i.item_date),
    partnerId: i.partner_id,
    orderId: i.purchase_order_id,
    sourceNo: i.source_no,
    sourceId: i.source_doc_id,
    createdByNo: i.entries[0]?.doc_no ?? "",
    balance: i.current_balance.toNumber(),
    original: i.original_amount.toNumber(),
  }));
}

/** Every item's balance equals the sum of its entries — proved from the entries alone. */
export async function apItemsReconcile(): Promise<boolean> {
  const sums = await prisma.finApLedger.groupBy({ by: ["item_id"], _sum: { movement: true } });
  const items = new Map((await prisma.finApItem.findMany({ select: { id: true, current_balance: true } })).map((i) => [i.id, i.current_balance.toNumber()]));
  if (sums.length !== items.size) return false;
  return sums.every((s) => cents(s._sum.movement?.toNumber() ?? 0) === cents(items.get(s.item_id) ?? NaN));
}
