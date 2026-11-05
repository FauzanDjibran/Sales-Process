import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { bookEventText, foldPartnerBook, type BookEntry, type BookKind, type PartnerBook } from "./partner-book";
import type { PeriodRange } from "./period";
import { ENTRY_PAGE_SIZE, afterBookCursor, type BookCursor } from "./register-query";

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
export type ApEvent = "Create" | "Payment" | "AdvanceUsed" | "AdvanceApplied" | "AdvanceReceived";

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
  /** What of the source document this posting pays — the item holds it (P214). */
  paid?: number;
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
  // An advance paid only in its PPN share is born at nil DPP but paid (P214).
  if (!(item.amount > 0) && !(item.type === "Advance" && item.amount === 0 && (item.paid ?? 0) > 0)) {
    throw new Error(`Nilai AP item harus lebih besar dari nol (diterima ${item.amount}).`);
  }
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
      paid_amount: item.paid ?? 0,
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
      movement: item.amount,
      doc_type_id: item.createdBy.docTypeId,
      doc_id: item.createdBy.docId,
      doc_no: item.createdBy.no,
      note: item.note ?? null,
      created_by: item.actorId,
    },
  });
  return row.id;
}

/**
 * What one payment of an AP advance bill brings into the bill's **one** Uang
 * Muka item (P133), as `receiveAdvance` on the AR side: the first payment
 * creates it, each later one raises it (`AdvanceReceived`) and adds to its
 * `original_amount`. It also holds what the bill has been paid (`paid`, cash +
 * PPh, P214), refused beyond the bill's total.
 */
export async function payAdvance(
  db: Prisma.TransactionClient,
  item: Omit<NewApItem, "type" | "dueDate" | "paid"> & { paid: number; documentTotal: number }
): Promise<number> {
  if (!(item.paid > 0) || item.amount < 0) throw new Error(`Pembayaran uang muka harus lebih besar dari nol (diterima ${item.paid}).`);
  const found = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM fin_ap_item
    WHERE item_type = 'Advance' AND source_doc_type_id = ${item.source.docTypeId} AND source_doc_id = ${item.source.docId}
    FOR UPDATE`;
  if (!found.length) {
    if (cents(item.paid) > cents(item.documentTotal)) throw new Error(`Pembayaran melebihi sisa ${item.source.no}.`);
    return createApItem(db, { ...item, type: "Advance" });
  }
  const id = found[0].id;
  const row = await db.finApItem.findUniqueOrThrow({ where: { id }, select: { current_balance: true, original_amount: true, paid_amount: true } });
  const after = (cents(row.current_balance.toNumber()) + cents(item.amount)) / 100;
  const original = (cents(row.original_amount.toNumber()) + cents(item.amount)) / 100;
  const paid = cents(row.paid_amount.toNumber()) + cents(item.paid);
  if (paid > cents(item.documentTotal)) throw new Error(`Pembayaran melebihi sisa ${item.source.no}.`);
  await db.finApItem.update({ where: { id }, data: { current_balance: after, original_amount: original, paid_amount: paid / 100 } });
  if (!(item.amount > 0)) return id; // paid only in its PPN share: no balance moves
  await db.finApLedger.create({
    data: {
      ...(await ledgerPosition(db, asDate(item.date), item.createdBy.docTypeId, item.createdBy.docId)),
      item_id: id,
      event: "AdvanceReceived",
      entry_date: asDate(item.date),
      movement: item.amount,
      doc_type_id: item.createdBy.docTypeId,
      doc_id: item.createdBy.docId,
      doc_no: item.createdBy.no,
      note: item.note ?? null,
      created_by: item.actorId,
    },
  });
  return id;
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
    event: Exclude<ApEvent, "Create" | "AdvanceReceived">;
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
  const item = await db.finApItem.findUniqueOrThrow({ where: { id: move.itemId }, select: { current_balance: true, paid_amount: true } });
  const balance = item.current_balance.toNumber();
  if (cents(move.amount) > cents(balance)) throw new ApItemOverdrawn(move.itemId, balance, move.amount);
  const after = (cents(balance) - cents(move.amount)) / 100;
  // A payment is what the source document has been paid (P214); an advance used or applied is not.
  const paid = move.event === "Payment" ? { paid_amount: (cents(item.paid_amount.toNumber()) + cents(move.amount)) / 100 } : {};
  await db.finApItem.update({ where: { id: move.itemId }, data: { current_balance: after, ...paid } });
  await db.finApLedger.create({
    data: {
      ...(await ledgerPosition(db, asDate(move.date), move.doc.docTypeId, move.doc.docId)),
      item_id: move.itemId,
      event: move.event,
      entry_date: asDate(move.date),
      movement: -move.amount,
      doc_type_id: move.doc.docTypeId,
      doc_id: move.doc.docId,
      doc_no: move.doc.no,
      counter_item_id: move.counterItemId ?? null,
      note: move.note ?? null,
      created_by: move.actorId,
    },
  });
}

/**
 * What each document has been paid, keyed by its id — read from its one item,
 * the holder of what was paid (P214). A document no payment has reached yet
 * has no item, and has been paid nothing.
 */
export async function apPaidByDocument(db: Db, docTable: string, ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const rows = await db.finApItem.findMany({
    where: { source_doc_type: { doc_table: docTable }, source_doc_id: { in: ids } },
    select: { source_doc_id: true, paid_amount: true },
  });
  return new Map(rows.map((r) => [r.source_doc_id, r.paid_amount.toNumber()]));
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

// ------------------------------------------------------------- reports
// Buku Hutang, Umur Hutang and Uang Muka Supplier (B33): the AR reports' reads mirrored.

export type ApItemRow = {
  id: number;
  apItemNo: string;
  type: ApItemType;
  partnerId: number;
  partnerLabel: string;
  partnerName: string;
  date: string;
  dueDate: string | null;
  /** What the item is about: the advance bill, the Invoice. */
  sourceNo: string;
  sourceTable: string;
  sourceId: number;
  /** The posting that created it — its Create entry's document. */
  createdByNo: string;
  createdByTable: string;
  createdById: number;
  /** By id: the order belongs to another module, whose page names it. */
  orderId: number | null;
  /** What the item was born at (P116). */
  original: number;
  /** What left the item up to the date asked about. */
  settled: number;
  /** Open at that date. */
  open: number;
};

/**
 * Every item of a type with a balance at the end of `asOf`, read from Buku
 * Piutang rather than `current_balance`, so a report for a past date is right
 * however much has moved since.
 */
export async function openApItemsAsOf(
  type: ApItemType,
  asOf: string,
  partnerId: number | null = null
): Promise<ApItemRow[]> {
  const items = await prisma.finApItem.findMany({
    where: { item_type: type, item_date: { lte: asDate(asOf) }, ...(partnerId ? { partner_id: partnerId } : {}) },
    include: {
      partner: { select: { partner_label: true, partner_name: true } },
      source_doc_type: { select: { doc_table: true } },
      entries: {
        where: { entry_date: { lte: asDate(asOf) } },
        select: { event: true, movement: true, doc_id: true, doc_no: true, doc_type: { select: { doc_table: true } } },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ item_date: "asc" }, { id: "asc" }],
  });
  return items
    .map((i) => {
      const created = i.entries.find((e) => e.event === "Create");
      // As of the date: an Uang Muka item grows with each payment (P133).
      const original = i.entries
        .filter((e) => e.event === "Create" || e.event === "AdvanceReceived")
        .reduce((a, e) => a + e.movement.toNumber(), 0);
      const open = i.entries.reduce((a, e) => a + e.movement.toNumber(), 0);
      return {
        id: i.id,
        apItemNo: i.ap_item_no,
        type: i.item_type as ApItemType,
        partnerId: i.partner_id,
        partnerLabel: i.partner.partner_label,
        partnerName: i.partner.partner_name,
        date: isoDay(i.item_date),
        dueDate: i.due_date ? isoDay(i.due_date) : null,
        sourceNo: i.source_no,
        sourceTable: i.source_doc_type.doc_table,
        sourceId: i.source_doc_id,
        createdByNo: created?.doc_no ?? "",
        createdByTable: created?.doc_type.doc_table ?? "",
        createdById: created?.doc_id ?? 0,
        orderId: i.purchase_order_id,
        original,
        settled: original - open,
        open,
      };
    })
    .filter((r) => Math.round(r.open * 100) !== 0);
}

/** Hutang Usaha or Uang Muka Supplier over a period: `arBook` mirrored (P233). */
export async function apBook(book: BookKind, range: PeriodRange, partnerIds: number[] = []): Promise<PartnerBook> {
  const items = await prisma.finApItem.findMany({
    where: { item_date: { lte: asDate(range.to) }, ...(partnerIds.length ? { partner_id: { in: partnerIds } } : {}) },
    select: {
      id: true,
      ap_item_no: true,
      item_type: true,
      partner_id: true,
      item_date: true,
      source_no: true,
      source_doc_id: true,
      purchase_order_id: true,
      partner: { select: { partner_label: true, partner_name: true } },
      source_doc_type: { select: { doc_table: true } },
      entries: {
        where: { entry_date: { lte: asDate(range.to) } },
        select: { event: true, movement: true, entry_date: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ item_date: "asc" }, { id: "asc" }],
  });
  return foldPartnerBook(
    items.map((i) => ({
      id: i.id,
      itemNo: i.ap_item_no,
      type: i.item_type as BookKind,
      partnerId: i.partner_id,
      partnerLabel: i.partner.partner_label,
      partnerName: i.partner.partner_name,
      date: isoDay(i.item_date),
      sourceNo: i.source_no,
      sourceTable: i.source_doc_type.doc_table,
      sourceId: i.source_doc_id,
      scopeTable: i.purchase_order_id ? "pur_order" : null,
      scopeId: i.purchase_order_id,
      entries: i.entries.map((e) => ({ event: e.event, date: isoDay(e.entry_date), movement: e.movement.toNumber() })),
    })),
    "ap",
    book,
    range
  );
}

/** One page of one supplier's entries in a book, oldest first. */
export async function apBookEntriesPage(
  book: BookKind,
  partnerId: number,
  range: PeriodRange,
  cursor: BookCursor | null
): Promise<{ entries: BookEntry[]; next: BookCursor | null }> {
  const rows = await prisma.finApLedger.findMany({
    where: {
      item: { partner_id: partnerId, item_type: book },
      entry_date: { gte: asDate(range.from), lte: asDate(range.to) },
      ...afterBookCursor(cursor),
    },
    include: {
      item: { select: { ap_item_no: true, source_no: true, purchase_order_id: true } },
      doc_type: { select: { doc_table: true } },
    },
    orderBy: [{ entry_date: "asc" }, { id: "asc" }],
    take: ENTRY_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, ENTRY_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    entries: page.map((r) => ({
      id: r.id,
      date: isoDay(r.entry_date),
      ledgerNo: r.ledger_no,
      docNo: r.doc_no,
      docTable: r.doc_type.doc_table,
      docId: r.doc_id,
      itemNo: r.item.ap_item_no,
      itemSourceNo: r.item.source_no,
      scopeTable: r.item.purchase_order_id ? "pur_order" : null,
      scopeId: r.item.purchase_order_id,
      eventText: bookEventText("ap", book, r.event),
      note: r.note,
      movement: r.movement.toNumber(),
    })),
    next: rows.length > ENTRY_PAGE_SIZE ? { date: isoDay(last.entry_date), id: last.id } : null,
  };
}

/** The suppliers that have ever had an AR item — the report's picker. */
export async function apPartnerOptions(): Promise<{ id: number; label: string; name: string; active: boolean }[]> {
  const rows = await prisma.mPartner.findMany({
    where: { ap_items: { some: {} } },
    orderBy: { partner_label: "asc" },
    select: { id: true, partner_label: true, partner_name: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.partner_label, name: r.partner_name, active: true }));
}

/**
 * Whether every item's stored balance equals the sum of its entries. The
 * stored figure is a convenience; the entries are the record (P72).
 */
export async function apItemsReconcileFor(partnerId: number | null = null): Promise<boolean> {
  const items = await prisma.finApItem.findMany({
    where: partnerId ? { partner_id: partnerId } : {},
    select: { current_balance: true, entries: { select: { movement: true } } },
  });
  return items.every(
    (i) =>
      Math.round(i.current_balance.toNumber() * 100) ===
      Math.round(i.entries.reduce((a, e) => a + e.movement.toNumber(), 0) * 100)
  );
}

