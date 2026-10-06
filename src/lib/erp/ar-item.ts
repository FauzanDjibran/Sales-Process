import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import type { PeriodRange } from "./period";

/**
 * AR items and Buku Piutang (Claude-ERP.md P71–P75).
 *
 * An **AR item** is the settlement unit of what a customer owes or has paid
 * ahead: an **Uang Muka** is born when an advance is received, an **Invoice**
 * when an Invoice Penjualan is posted. Documents stay the origin; the item is
 * what remains open, and it keeps its own balance.
 *
 * **Buku Piutang** is the history of every change to an item's balance, and it
 * is append-only: an entry is never edited or deleted. The item's
 * `current_balance` is the sum of its entries, written in the same transaction
 * as each one, so the two can never disagree — and `arItemsReconcile` proves
 * it from the entries alone, the way the Cash Bank Book is proved.
 *
 * Each item is named `ARI/YYYY/MM/NNNN` and is **about** one document — the
 * advance bill for an Uang Muka, the Invoice for an Invoice; what created it is
 * its Create entry's document (U1). It carries its own tax document's figures
 * where it has one — an Uang Muka its Faktur Pajak Uang Muka (U9).
 *
 * There is no allocation step (P72): a payment moves an Invoice item directly,
 * and an Invoice uses its order's Uang Muka when it is posted. The entry names
 * the document that did it, and — for an advance used — the Invoice item that
 * took it.
 *
 * **It is a book**: it depends on nothing but the shared kernel. Documents call
 * it inside their posting transaction, as they call the journal and the Cash
 * Bank Book; it never reaches back to them.
 *
 * AP will have tables of its own (P71).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type ArItemType = "Advance" | "Invoice";
export type ArEvent = "Create" | "Payment" | "AdvanceUsed" | "AdvanceApplied";

export const AR_TYPE_TEXT: Record<ArItemType, string> = {
  Advance: "Uang Muka",
  Invoice: "Invoice",
};

export const AR_EVENT_TEXT: Record<ArEvent, string> = {
  Create: "Terbentuk",
  Payment: "Pembayaran",
  AdvanceUsed: "Dipakai Invoice",
  AdvanceApplied: "Uang Muka Diterapkan",
};

/**
 * Which way an item moves the customer's Piutang Usaha: an Invoice raises it,
 * an Uang Muka lowers it. Exposure = balance × this.
 */
export const AR_SIGN: Record<ArItemType, 1 | -1> = { Invoice: 1, Advance: -1 };

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

// ------------------------------------------------------------------ writes

export type NewArItem = {
  type: ArItemType;
  partnerId: number;
  currencyId: number;
  /** `YYYY-MM-DD`. */
  date: string;
  dueDate?: string | null;
  /** What the item is about: the advance bill, the Invoice (U1). */
  source: { docTypeId: number; docId: number; no: string };
  /** The posting that creates it — named by the Create entry only. */
  createdBy: { docTypeId: number; docId: number; no: string };
  /** The Customer Order it is settled within (P73, P78). */
  orderId?: number | null;
  /** What it is born at — also kept as its original amount (P116). */
  amount: number;
  note?: string | null;
  actorId: number;
};

/**
 * The ledger number and line an entry takes (P110): `BP/2026/10/0001`, one per
 * posting. A document posts once, so the entries naming the same document —
 * a receipt's items, an Invoice's item and the advances it used — belong to
 * one posting and share its number, a line each; the first takes the next
 * number in the series of its month, read from line-1 rows, whose id order is
 * their number order.
 */
async function ledgerPosition(db: Db, date: Date, docTypeId: number, docId: number): Promise<{ ledger_no: string; line_no: number }> {
  const last = await db.finArLedger.findFirst({
    where: { doc_type_id: docTypeId, doc_id: docId },
    orderBy: { line_no: "desc" },
    select: { ledger_no: true, line_no: true },
  });
  if (last) return { ledger_no: last.ledger_no, line_no: last.line_no + 1 };
  const ledger_no = await nextDocumentNumber("BP", date, async (series) => {
    const row = await db.finArLedger.findFirst({
      where: { ledger_no: { startsWith: series }, line_no: 1 },
      orderBy: { id: "desc" },
      select: { ledger_no: true },
    });
    return row?.ledger_no ?? null;
  });
  return { ledger_no, line_no: 1 };
}

/** Creates an item and its Create entry, inside the caller's transaction. */
export async function createArItem(db: Db, item: NewArItem): Promise<number> {
  if (!(item.amount > 0)) {
    throw new Error(`Nilai AR item harus lebih besar dari nol (diterima ${item.amount}).`);
  }
  const date = asDate(item.date);
  const arItemNo = await nextDocumentNumber("ARI", date, async (series) => {
    const last = await db.finArItem.findFirst({
      where: { ar_item_no: { startsWith: series } },
      orderBy: { ar_item_no: "desc" },
      select: { ar_item_no: true },
    });
    return last?.ar_item_no ?? null;
  });
  const row = await db.finArItem.create({
    data: {
      ar_item_no: arItemNo,
      item_type: item.type,
      direction: AR_SIGN[item.type] > 0 ? "Increase" : "Decrease",
      partner_id: item.partnerId,
      currency_id: item.currencyId,
      item_date: date,
      due_date: item.dueDate ? asDate(item.dueDate) : null,
      source_doc_type_id: item.source.docTypeId,
      source_doc_id: item.source.docId,
      source_no: item.source.no,
      customer_order_id: item.orderId ?? null,
      current_balance: item.amount,
      original_amount: item.amount,
      created_by: item.actorId,
    },
    select: { id: true },
  });
  await db.finArLedger.create({
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

/** An item's balance would go below zero — the whole posting is refused. */
export class ArItemOverdrawn extends Error {
  constructor(readonly itemId: number, readonly balance: number, readonly requested: number) {
    super(`Sisa AR item tidak mencukupi: tersisa ${balance}, diminta ${requested}. Posting dibatalkan.`);
    this.name = "ArItemOverdrawn";
  }
}

/**
 * Lowers an item's balance by `amount` — a payment on an Invoice, an advance
 * used by an Invoice — with the row locked, and writes the entry. Thrown
 * rather than returned, like `InsufficientFunds`: the caller is inside its
 * posting transaction and must go down whole.
 */
export async function settleArItem(
  db: Prisma.TransactionClient,
  move: {
    itemId: number;
    event: Exclude<ArEvent, "Create">;
    amount: number;
    date: string;
    doc: { docTypeId: number; docId: number; no: string };
    counterItemId?: number | null;
    note?: string | null;
    actorId: number;
  }
): Promise<void> {
  if (!(move.amount > 0)) throw new Error("Nilai penyelesaian AR item harus lebih besar dari nol.");
  await db.$queryRaw`SELECT id FROM fin_ar_item WHERE id = ${move.itemId} FOR UPDATE`;
  const item = await db.finArItem.findUniqueOrThrow({ where: { id: move.itemId }, select: { current_balance: true } });
  const balance = item.current_balance.toNumber();
  const cents = (n: number) => Math.round(n * 100);
  if (cents(move.amount) > cents(balance)) throw new ArItemOverdrawn(move.itemId, balance, move.amount);
  const after = (cents(balance) - cents(move.amount)) / 100;
  await db.finArItem.update({ where: { id: move.itemId }, data: { current_balance: after } });
  await db.finArLedger.create({
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

// ------------------------------------------------------------------- reads

export type ArItemRow = {
  id: number;
  arItemNo: string;
  type: ArItemType;
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
export async function openArItemsAsOf(
  type: ArItemType,
  asOf: string,
  partnerId: number | null = null
): Promise<ArItemRow[]> {
  const items = await prisma.finArItem.findMany({
    where: { item_type: type, item_date: { lte: asDate(asOf) }, ...(partnerId ? { partner_id: partnerId } : {}) },
    include: {
      partner: { select: { partner_label: true, partner_name: true } },
      source_doc_type: { select: { doc_table: true } },
      entries: {
        where: { entry_date: { lte: asDate(asOf) } },
        select: { event: true, amount: true, movement: true, doc_id: true, doc_no: true, doc_type: { select: { doc_table: true } } },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ item_date: "asc" }, { id: "asc" }],
  });
  return items
    .map((i) => {
      const created = i.entries.find((e) => e.event === "Create");
      const original = i.original_amount.toNumber();
      const open = i.entries.reduce((a, e) => a + e.movement.toNumber(), 0);
      return {
        id: i.id,
        arItemNo: i.ar_item_no,
        type: i.item_type as ArItemType,
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
        orderId: i.customer_order_id,
        original,
        settled: original - open,
        open,
      };
    })
    .filter((r) => Math.round(r.open * 100) !== 0);
}

export type ArLedgerEntryRow = {
  id: number;
  date: string;
  itemId: number;
  type: ArItemType;
  event: ArEvent;
  /** The posting's Buku Piutang number (P110), shared by its entries. */
  ledgerNo: string;
  docNo: string;
  docTable: string;
  docId: number;
  /** The item's own identity: its number and what it is about. */
  itemNo: string;
  itemSourceNo: string;
  orderId: number | null;
  note: string | null;
  /** Signed on the customer's Piutang Usaha: + raises it, − lowers it. */
  exposure: number;
};

export type ArLedgerReport = {
  partner: { id: number; label: string; name: string };
  range: PeriodRange;
  /** Whether Uang Muka entries are in the book, or only stated beside it (P77). */
  includeAdvance: boolean;
  /** Piutang Usaha position at the start: Σ exposure before `range.from`. */
  opening: number;
  entries: ArLedgerEntryRow[];
  increase: number;
  decrease: number;
  closing: number;
  /** What each type holds at the end, as a positive figure. */
  closingByType: Record<ArItemType, number>;
};

/**
 * Buku Piutang of one customer over a period: every entry on their items,
 * oldest first, each signed on their Piutang Usaha position, with the position
 * before and after.
 *
 * By default the book holds **Invoice items only** and states the Uang Muka
 * still held beside it, as mainstream ERPs keep a customer's down payments out
 * of the receivables line until they are cleared against an invoice (P77).
 * `includeAdvance` puts the Uang Muka entries in, netting the position.
 */
export async function arLedgerReport(
  partnerId: number,
  range: PeriodRange,
  opts: { includeAdvance?: boolean } = {}
): Promise<ArLedgerReport | null> {
  const includeAdvance = Boolean(opts.includeAdvance);
  const partner = await prisma.mPartner.findUnique({
    where: { id: partnerId },
    select: { id: true, partner_label: true, partner_name: true },
  });
  if (!partner) return null;
  const rows = await prisma.finArLedger.findMany({
    where: { item: { partner_id: partnerId }, entry_date: { lte: asDate(range.to) } },
    include: {
      item: { select: { item_type: true, ar_item_no: true, source_no: true, customer_order_id: true } },
      doc_type: { select: { doc_table: true } },
    },
    orderBy: [{ entry_date: "asc" }, { id: "asc" }],
  });
  const exposureOf = (r: (typeof rows)[number]) => r.movement.toNumber() * AR_SIGN[r.item.item_type as ArItemType];

  let opening = 0;
  const entries: ArLedgerEntryRow[] = [];
  const closingByType: Record<ArItemType, number> = { Advance: 0, Invoice: 0 };
  for (const r of rows) {
    closingByType[r.item.item_type as ArItemType] += r.movement.toNumber();
    // Uang Muka is shown beside the book, not in it, unless asked for (P77).
    if (!includeAdvance && r.item.item_type === "Advance") continue;
    if (isoDay(r.entry_date) < range.from) {
      opening += exposureOf(r);
      continue;
    }
    entries.push({
      id: r.id,
      date: isoDay(r.entry_date),
      itemId: r.item_id,
      type: r.item.item_type as ArItemType,
      event: r.event as ArEvent,
      ledgerNo: r.ledger_no,
      docNo: r.doc_no,
      docTable: r.doc_type.doc_table,
      docId: r.doc_id,
      itemNo: r.item.ar_item_no,
      itemSourceNo: r.item.source_no,
      orderId: r.item.customer_order_id,
      note: r.note,
      exposure: exposureOf(r),
    });
  }
  const increase = entries.filter((e) => e.exposure > 0).reduce((a, e) => a + e.exposure, 0);
  // `|| 0` so an empty period reads 0, not −0.
  const decrease = -entries.filter((e) => e.exposure < 0).reduce((a, e) => a + e.exposure, 0) || 0;
  return {
    partner: { id: partner.id, label: partner.partner_label, name: partner.partner_name },
    range,
    includeAdvance,
    opening,
    entries,
    increase,
    decrease,
    closing: opening + increase - decrease,
    closingByType,
  };
}

/** The customers that have ever had an AR item — the report's picker. */
export async function arPartnerOptions(): Promise<{ id: number; label: string; name: string; active: boolean }[]> {
  const rows = await prisma.mPartner.findMany({
    where: { ar_items: { some: {} } },
    orderBy: { partner_label: "asc" },
    select: { id: true, partner_label: true, partner_name: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.partner_label, name: r.partner_name, active: true }));
}

/**
 * Whether every item's stored balance equals the sum of its entries. The
 * stored figure is a convenience; the entries are the record (P72).
 */
export async function arItemsReconcile(partnerId: number | null = null): Promise<boolean> {
  const items = await prisma.finArItem.findMany({
    where: partnerId ? { partner_id: partnerId } : {},
    select: { current_balance: true, entries: { select: { movement: true } } },
  });
  return items.every(
    (i) =>
      Math.round(i.current_balance.toNumber() * 100) ===
      Math.round(i.entries.reduce((a, e) => a + e.movement.toNumber(), 0) * 100)
  );
}

// ------------------------------------------------------ for the Invoice

/**
 * An Uang Muka item as an Invoice reads it (U7, U8): the item, what it is about,
 * the receipt that created it, its original DPP and its balance. Balances only
 * (P116): the PPN of the part used is recalculated from the DPP (P118), and the
 * faktur pajak's NSFP is the tax module's, composed by the page.
 */
export type AdvanceItemForInvoice = {
  id: number;
  arItemNo: string;
  date: string;
  partnerId: number;
  orderId: number | null;
  /** The advance bill. */
  sourceNo: string;
  sourceTable: string;
  sourceId: number;
  /** The receipt, from the Create entry. */
  createdByNo: string;
  balance: number;
  /** The DPP it was born at; what posted Invoices used of it is original − balance. */
  original: number;
};

/** Uang Muka items of the orders named with a balance left, or the items named — whatever their balance. */
export async function advanceItemsForInvoice(
  filter: { orderIds?: number[]; ids?: number[] },
  db: Db = prisma
): Promise<AdvanceItemForInvoice[]> {
  const rows = await db.finArItem.findMany({
    where: {
      item_type: "Advance",
      ...(filter.ids ? { id: { in: filter.ids } } : { customer_order_id: { in: filter.orderIds ?? [] }, current_balance: { gt: 0 } }),
    },
    include: {
      source_doc_type: { select: { doc_table: true } },
      entries: { where: { event: "Create" }, select: { doc_no: true, amount: true } },
    },
    orderBy: [{ item_date: "asc" }, { id: "asc" }],
  });
  return rows.map((i) => ({
    id: i.id,
    arItemNo: i.ar_item_no,
    date: isoDay(i.item_date),
    partnerId: i.partner_id,
    orderId: i.customer_order_id,
    sourceNo: i.source_no,
    sourceTable: i.source_doc_type.doc_table,
    sourceId: i.source_doc_id,
    createdByNo: i.entries[0]?.doc_no ?? "",
    balance: i.current_balance.toNumber(),
    original: i.original_amount.toNumber(),
  }));
}

// ------------------------------------------------------- for the receipt

/** The Invoice items with something still to pay — the open receivables, as ids. */
export async function openInvoiceItemIds(db: Db = prisma): Promise<number[]> {
  const rows = await db.finArItem.findMany({ where: { item_type: "Invoice", current_balance: { gt: 0 } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Items' balances now, by id — what is still open on each. */
export async function arItemBalances(ids: number[], db: Db = prisma): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const rows = await db.finArItem.findMany({ where: { id: { in: ids } }, select: { id: true, current_balance: true } });
  return new Map(rows.map((r) => [r.id, r.current_balance.toNumber()]));
}

/**
 * Locks items' rows for the rest of the transaction, so a posting that reads
 * their balances and then moves them cannot be passed by another (U28).
 */
export async function lockArItems(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await tx.$queryRaw`SELECT id FROM fin_ar_item WHERE id = ${id} FOR UPDATE`;
  }
}

// ------------------------------------------------------- for the tax module

/** The Uang Muka items a posting created, with the bill each is about. */
export async function advanceItemsCreatedBy(
  db: Db,
  createdBy: { docTypeId: number; docId: number }
): Promise<{ id: number; arItemNo: string; sourceDocId: number }[]> {
  const rows = await db.finArItem.findMany({
    where: { item_type: "Advance", entries: { some: { event: "Create", doc_type_id: createdBy.docTypeId, doc_id: createdBy.docId } } },
    select: { id: true, ar_item_no: true, source_doc_id: true },
  });
  return rows.map((r) => ({ id: r.id, arItemNo: r.ar_item_no, sourceDocId: r.source_doc_id }));
}
