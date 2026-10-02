import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { originate, relieve } from "./fx";
import type { PeriodRange } from "./period";

/**
 * AR items and Buku Piutang (Claude-ERP.md P71–P75, P87–P92).
 *
 * An **AR item** is the one place every menu of the receivables engine reads
 * from: each menu writes its own tables and hands work on only through an item
 * (P87). So an item carries everything the next menu calculates with — its open
 * amount split into **DPP, PPN and the PPh still expected**, its partner, its
 * currency and its Customer Order — and names the document it is about only for
 * display and drill-down, never to calculate.
 *
 * **One item per document per type** (P88), so a user sees one thing where
 * there is one thing:
 *
 *   Tagihan Uang Muka  (AdvanceRequest) what an issued advance bill still asks
 *                       for — a noted item: no General Ledger effect, outside
 *                       the Piutang reports
 *   Uang Muka          (Advance) what the customer has paid ahead on one bill;
 *                       born at the first receipt, raised by each later one
 *   Invoice            what the customer owes on one Faktur Penjualan
 *
 * **Buku Piutang** is the history of every change, append-only: an entry is
 * never edited or deleted. The item's open figures are the sums of its entries,
 * written in the same transaction as each, so the two can never disagree — and
 * `arItemsReconcile` proves it from the entries alone. Each entry also keeps
 * the receipt-level detail the item pools: the Terbentuk and Diterima entries
 * of an Uang Muka item are its receipts, one Faktur Pajak Uang Muka each.
 *
 * Every movement carries a base-currency value (P92): money arriving takes its
 * own rate, money leaving takes the item's carrying rate, and the last release
 * takes the base that is left exactly (`fx.ts`). In rupiah all of it is rate 1.
 *
 * There is no allocation step (P72): a payment moves an item directly, and a
 * Faktur uses its order's Uang Muka when it is posted.
 *
 * **It is a book**: it depends on nothing but the shared kernel. Documents call
 * it inside their posting transaction, as they call the journal and the Cash
 * Bank Book; it never reaches back to them. AP will have tables of its own.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type ArItemType = "AdvanceRequest" | "Advance" | "Invoice";
export type ArEvent = "Create" | "Received" | "Payment" | "AdvanceUsed" | "Cancelled";

export const AR_TYPE_TEXT: Record<ArItemType, string> = {
  AdvanceRequest: "Tagihan Uang Muka",
  Advance: "Uang Muka",
  Invoice: "Invoice",
};

export const AR_EVENT_TEXT: Record<ArEvent, string> = {
  Create: "Terbentuk",
  Received: "Diterima",
  Payment: "Pembayaran",
  AdvanceUsed: "Dipakai Invoice",
  Cancelled: "Dibatalkan",
};

/**
 * Which way an item moves the customer's Piutang Usaha: an Invoice raises it,
 * an Uang Muka lowers it, a noted Tagihan does neither. Exposure = balance × this.
 */
export const AR_SIGN: Record<ArItemType, 1 | -1 | 0> = { Invoice: 1, Advance: -1, AdvanceRequest: 0 };

/** The types the Piutang reports and the General Ledger see; a noted item is neither. */
export const AR_BOOKED_TYPES: ("Advance" | "Invoice")[] = ["Advance", "Invoice"];

/** Only an Uang Muka item is raised after it is born: each receipt on its bill adds to it. */
const RECEIVING_TYPES: ArItemType[] = ["Advance"];

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const cents = (n: number) => Math.round(n * 100);

/** An amount of an item and the parts it is made of. `gross` = `dpp` + `ppn`. */
export type ArAmounts = {
  gross: number;
  dpp: number;
  ppn: number;
  /** PPh still expected to be withheld on it; not part of `gross`. */
  pph: number;
};

/** What a customer is expected to withhold on an item, per Jenis PPh. */
export type ArWithholding = { taxId: number; rate: number; base: number; amount: number };

export type ArDocRef = { docTypeId: number; docId: number; no: string };

const ZERO: ArAmounts = { gross: 0, dpp: 0, ppn: 0, pph: 0 };

function amountsProblem(a: ArAmounts): string | null {
  if (!(a.gross > 0)) return `Nilai AR item harus lebih besar dari nol (diterima ${a.gross}).`;
  if ([a.dpp, a.ppn, a.pph].some((x) => x < 0)) return "Bagian DPP, PPN dan PPh AR item tidak boleh negatif.";
  if (cents(a.dpp) + cents(a.ppn) !== cents(a.gross)) {
    return `DPP ${a.dpp} + PPN ${a.ppn} harus sama dengan nilai ${a.gross}.`;
  }
  return null;
}

// ------------------------------------------------------------------ writes

export type NewArItem = {
  type: ArItemType;
  partnerId: number;
  currencyId: number;
  /** `YYYY-MM-DD` — the date of the posting that creates it. */
  date: string;
  dueDate?: string | null;
  /** The document the item is about (P87). */
  source: ArDocRef;
  /** The Customer Order it belongs to (P73, P78). */
  order?: { id: number; no: string } | null;
  amounts: ArAmounts;
  /** Expected withholding per Jenis PPh; their amounts sum to `amounts.pph`. */
  withholdings?: ArWithholding[];
  /** The rate that values it in the base currency (P92); 1 in the base currency. */
  rate?: number;
  /** The posting that creates it — the bill for a Tagihan, the receipt for an Uang Muka. */
  by: ArDocRef;
  note?: string | null;
  actorId: number;
};

/** Another item of this type already exists for the document (P88). */
export class ArItemExists extends Error {
  constructor(readonly type: ArItemType, readonly sourceNo: string) {
    super(`AR item ${type} untuk ${sourceNo} sudah ada.`);
    this.name = "ArItemExists";
  }
}

/** Creates an item and its Terbentuk entry, inside the caller's transaction. */
export async function createArItem(db: Db, item: NewArItem): Promise<{ itemId: number; entryId: number }> {
  const problem = amountsProblem(item.amounts);
  if (problem) throw new Error(problem);
  const whts = item.withholdings ?? [];
  if (cents(whts.reduce((s, w) => s + w.amount, 0)) !== cents(item.amounts.pph)) {
    throw new Error("PPh per Jenis PPh harus berjumlah sama dengan PPh AR item.");
  }
  const exists = await findArItem(db, item.type, item.source.docTypeId, item.source.docId);
  if (exists) throw new ArItemExists(item.type, item.source.no);

  const rate = item.rate ?? 1;
  const base = originate(item.amounts.gross, rate).base;
  const row = await db.finArItem.create({
    data: {
      item_type: item.type,
      direction: AR_SIGN[item.type] < 0 ? "Decrease" : "Increase",
      partner_id: item.partnerId,
      currency_id: item.currencyId,
      item_date: asDate(item.date),
      due_date: item.dueDate ? asDate(item.dueDate) : null,
      source_doc_type_id: item.source.docTypeId,
      source_doc_id: item.source.docId,
      source_no: item.source.no,
      customer_order_id: item.order?.id ?? null,
      customer_order_no: item.order?.no ?? null,
      current_balance: item.amounts.gross,
      current_dpp: item.amounts.dpp,
      current_ppn: item.amounts.ppn,
      current_pph: item.amounts.pph,
      current_base_balance: base,
      created_by: item.actorId,
    },
    select: { id: true },
  });
  // Written as its own statement: a nested create inside a transaction makes
  // the driver adapter issue two queries on one connection at once.
  if (whts.length) {
    await db.finArItemWht.createMany({
      data: whts.map((w) => ({
        item_id: row.id,
        withholding_tax_id: w.taxId,
        rate: w.rate,
        base_amount: w.base,
        amount: w.amount,
      })),
    });
  }
  const entry = await db.finArLedger.create({
    data: {
      item_id: row.id,
      event: "Create",
      entry_date: asDate(item.date),
      amount: item.amounts.gross,
      movement: item.amounts.gross,
      balance_after: item.amounts.gross,
      dpp_movement: item.amounts.dpp,
      ppn_movement: item.amounts.ppn,
      pph_movement: item.amounts.pph,
      rate,
      base_movement: base,
      doc_type_id: item.by.docTypeId,
      doc_id: item.by.docId,
      doc_no: item.by.no,
      note: item.note ?? null,
      created_by: item.actorId,
    },
    select: { id: true },
  });
  return { itemId: row.id, entryId: entry.id };
}

/** The item of a type for a document, or null (P88: there is at most one). */
export async function findArItem(db: Db, type: ArItemType, sourceDocTypeId: number, sourceDocId: number): Promise<number | null> {
  const row = await db.finArItem.findUnique({
    where: {
      item_type_source_doc_type_id_source_doc_id: {
        item_type: type,
        source_doc_type_id: sourceDocTypeId,
        source_doc_id: sourceDocId,
      },
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Locks items' rows for the rest of the transaction, in id order, so two
 * postings cannot both move the last of one item.
 */
export async function lockArItems(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await tx.$queryRaw`SELECT id FROM fin_ar_item WHERE id = ${id} FOR UPDATE`;
  }
}

async function lockedItem(tx: Prisma.TransactionClient, itemId: number) {
  await tx.$queryRaw`SELECT id FROM fin_ar_item WHERE id = ${itemId} FOR UPDATE`;
  return tx.finArItem.findUniqueOrThrow({
    where: { id: itemId },
    select: {
      item_type: true,
      current_balance: true,
      current_dpp: true,
      current_ppn: true,
      current_pph: true,
      current_base_balance: true,
    },
  });
}

/**
 * Raises an Uang Muka item by money received for the same bill (P88): the
 * Diterima entry, valued at the rate the money came in at. Any other type
 * refuses — only a receipt adds to what a customer holds.
 */
export async function receiveArItem(
  tx: Prisma.TransactionClient,
  move: { itemId: number; amounts: ArAmounts; rate?: number; date: string; doc: ArDocRef; note?: string | null; actorId: number }
): Promise<number> {
  const problem = amountsProblem(move.amounts);
  if (problem) throw new Error(problem);
  const item = await lockedItem(tx, move.itemId);
  if (!RECEIVING_TYPES.includes(item.item_type as ArItemType)) {
    throw new Error(`AR item ${item.item_type} tidak dapat bertambah setelah terbentuk.`);
  }
  const rate = move.rate ?? 1;
  const base = originate(move.amounts.gross, rate).base;
  const after = {
    gross: (cents(item.current_balance.toNumber()) + cents(move.amounts.gross)) / 100,
    dpp: (cents(item.current_dpp.toNumber()) + cents(move.amounts.dpp)) / 100,
    ppn: (cents(item.current_ppn.toNumber()) + cents(move.amounts.ppn)) / 100,
    pph: (cents(item.current_pph.toNumber()) + cents(move.amounts.pph)) / 100,
    base: (cents(item.current_base_balance.toNumber()) + cents(base)) / 100,
  };
  await tx.finArItem.update({
    where: { id: move.itemId },
    data: {
      current_balance: after.gross,
      current_dpp: after.dpp,
      current_ppn: after.ppn,
      current_pph: after.pph,
      current_base_balance: after.base,
    },
  });
  const entry = await tx.finArLedger.create({
    data: {
      item_id: move.itemId,
      event: "Received",
      entry_date: asDate(move.date),
      amount: move.amounts.gross,
      movement: move.amounts.gross,
      balance_after: after.gross,
      dpp_movement: move.amounts.dpp,
      ppn_movement: move.amounts.ppn,
      pph_movement: move.amounts.pph,
      rate,
      base_movement: base,
      doc_type_id: move.doc.docTypeId,
      doc_id: move.doc.docId,
      doc_no: move.doc.no,
      note: move.note ?? null,
      created_by: move.actorId,
    },
    select: { id: true },
  });
  return entry.id;
}

/** An item would go below zero in some part — the whole posting is refused. */
export class ArItemOverdrawn extends Error {
  constructor(readonly itemId: number, readonly balance: number, readonly requested: number) {
    super(`Sisa AR item tidak mencukupi: tersisa ${balance}, diminta ${requested}. Posting dibatalkan.`);
    this.name = "ArItemOverdrawn";
  }
}

/**
 * Lowers an item — a payment on a Tagihan or an Invoice, an advance used by an
 * Invoice, a noted item closed — with the row locked, and writes the entry.
 * Every part is checked: none may go below zero. Thrown rather than returned,
 * like `InsufficientFunds`: the caller is inside its posting transaction and
 * must go down whole.
 *
 * The base released is the item's carrying rate times what leaves, and the
 * last release takes exactly the base that is left (P92, `fx.relieve`).
 */
export async function settleArItem(
  tx: Prisma.TransactionClient,
  move: {
    itemId: number;
    event: Exclude<ArEvent, "Create" | "Received">;
    amounts: ArAmounts;
    date: string;
    doc: ArDocRef;
    counterItemId?: number | null;
    sourceEntryId?: number | null;
    note?: string | null;
    actorId: number;
  }
): Promise<number> {
  const problem = amountsProblem(move.amounts);
  if (problem) throw new Error(problem);
  const item = await lockedItem(tx, move.itemId);
  const open = {
    gross: item.current_balance.toNumber(),
    dpp: item.current_dpp.toNumber(),
    ppn: item.current_ppn.toNumber(),
    pph: item.current_pph.toNumber(),
  };
  for (const k of ["gross", "dpp", "ppn", "pph"] as const) {
    if (cents(move.amounts[k]) > cents(open[k])) throw new ArItemOverdrawn(move.itemId, open[k], move.amounts[k]);
  }
  const relief = relieve({ foreign: open.gross, base: item.current_base_balance.toNumber() }, move.amounts.gross);
  const after = {
    gross: (cents(open.gross) - cents(move.amounts.gross)) / 100,
    dpp: (cents(open.dpp) - cents(move.amounts.dpp)) / 100,
    ppn: (cents(open.ppn) - cents(move.amounts.ppn)) / 100,
    pph: (cents(open.pph) - cents(move.amounts.pph)) / 100,
  };
  await tx.finArItem.update({
    where: { id: move.itemId },
    data: {
      current_balance: after.gross,
      current_dpp: after.dpp,
      current_ppn: after.ppn,
      current_pph: after.pph,
      current_base_balance: relief.remaining.base,
    },
  });
  const entry = await tx.finArLedger.create({
    data: {
      item_id: move.itemId,
      event: move.event,
      entry_date: asDate(move.date),
      amount: move.amounts.gross,
      movement: -move.amounts.gross,
      balance_after: after.gross,
      dpp_movement: -move.amounts.dpp,
      ppn_movement: -move.amounts.ppn,
      pph_movement: -move.amounts.pph,
      // The effective rate this release was carried at — information on the
      // entry, never an input to anything.
      rate: move.amounts.gross ? Math.round((relief.base / move.amounts.gross) * 1e6) / 1e6 : 1,
      base_movement: -relief.base,
      doc_type_id: move.doc.docTypeId,
      doc_id: move.doc.docId,
      doc_no: move.doc.no,
      counter_item_id: move.counterItemId ?? null,
      source_entry_id: move.sourceEntryId ?? null,
      note: move.note ?? null,
      created_by: move.actorId,
    },
    select: { id: true },
  });
  return entry.id;
}

/** Closes what is left of a noted item — its bill was cancelled. */
export async function closeArItem(
  tx: Prisma.TransactionClient,
  move: { itemId: number; date: string; doc: ArDocRef; note?: string | null; actorId: number }
): Promise<void> {
  const item = await lockedItem(tx, move.itemId);
  if (item.item_type !== "AdvanceRequest") throw new Error("Hanya Tagihan Uang Muka yang ditutup dengan pembatalan.");
  if (!(item.current_balance.toNumber() > 0)) return;
  await settleArItem(tx, {
    itemId: move.itemId,
    event: "Cancelled",
    amounts: {
      gross: item.current_balance.toNumber(),
      dpp: item.current_dpp.toNumber(),
      ppn: item.current_ppn.toNumber(),
      pph: item.current_pph.toNumber(),
    },
    date: move.date,
    doc: move.doc,
    note: move.note,
    actorId: move.actorId,
  });
}

// ------------------------------------------------------- the open item

/**
 * An item as the next menu reads it (P87): everything needed to settle it, and
 * nothing that would send the reader to the document. `original` is what came
 * in — the Terbentuk entry and every Diterima — and `open` what is left.
 */
export type ArOpenItem = {
  id: number;
  type: ArItemType;
  partnerId: number;
  currencyId: number;
  date: string;
  dueDate: string | null;
  source: { docTypeId: number; table: string; docId: number; no: string };
  orderId: number | null;
  orderNo: string | null;
  original: ArAmounts;
  open: ArAmounts;
  /** Expected withholding per Jenis PPh as the item was created; `key` is the Jenis PPh id. */
  withholdings: { key: string; rate: number; base: number; amount: number }[];
  /** Σ of the Pembayaran entries — what receipts have settled. */
  paid: number;
};

export async function openArItems(
  db: Db,
  filter: { type: ArItemType; partnerId?: number | null; sourceTable?: string; sourceIds?: number[]; onlyOpen?: boolean }
): Promise<ArOpenItem[]> {
  // Read in separate statements, one after another: relations loaded with
  // `include` inside a transaction are fetched in parallel on one connection,
  // which the driver adapter warns about.
  const rows = await db.finArItem.findMany({
    where: {
      item_type: filter.type,
      ...(filter.partnerId ? { partner_id: filter.partnerId } : {}),
      ...(filter.sourceTable ? { source_doc_type: { doc_table: filter.sourceTable } } : {}),
      ...(filter.sourceIds ? { source_doc_id: { in: filter.sourceIds } } : {}),
      ...(filter.onlyOpen ? { current_balance: { gt: 0 } } : {}),
    },
    orderBy: [{ item_date: "asc" }, { id: "asc" }],
  });
  const ids = rows.map((r) => r.id);
  const entries = await db.finArLedger.findMany({
    where: { item_id: { in: ids } },
    select: { item_id: true, event: true, amount: true, dpp_movement: true, ppn_movement: true, pph_movement: true },
  });
  const whts = await db.finArItemWht.findMany({ where: { item_id: { in: ids } }, orderBy: { id: "asc" } });
  const tables = new Map(
    (await db.sysDocType.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.source_doc_type_id))] } }, select: { id: true, doc_table: true } })).map(
      (t) => [t.id, t.doc_table]
    )
  );
  return rows.map((i) => {
    const original = { ...ZERO };
    let paid = 0;
    for (const e of entries.filter((x) => x.item_id === i.id)) {
      if (e.event === "Create" || e.event === "Received") {
        original.gross += e.amount.toNumber();
        original.dpp += e.dpp_movement.toNumber();
        original.ppn += e.ppn_movement.toNumber();
        original.pph += e.pph_movement.toNumber();
      } else if (e.event === "Payment") paid += e.amount.toNumber();
    }
    return {
      id: i.id,
      type: i.item_type as ArItemType,
      partnerId: i.partner_id,
      currencyId: i.currency_id,
      date: isoDay(i.item_date),
      dueDate: i.due_date ? isoDay(i.due_date) : null,
      source: { docTypeId: i.source_doc_type_id, table: tables.get(i.source_doc_type_id) ?? "", docId: i.source_doc_id, no: i.source_no },
      orderId: i.customer_order_id,
      orderNo: i.customer_order_no,
      original,
      open: {
        gross: i.current_balance.toNumber(),
        dpp: i.current_dpp.toNumber(),
        ppn: i.current_ppn.toNumber(),
        pph: i.current_pph.toNumber(),
      },
      withholdings: whts.filter((w) => w.item_id === i.id).map((w) => ({
        key: String(w.withholding_tax_id),
        rate: w.rate.toNumber(),
        base: w.base_amount.toNumber(),
        amount: w.amount.toNumber(),
      })),
      paid,
    };
  });
}

/**
 * The entries an Uang Muka item was built from — one per receipt (Terbentuk,
 * then each Diterima) — with what each still holds after what later entries
 * drew from it (P91). A Faktur uses them oldest first, so the part of each
 * Faktur Pajak Uang Muka it deducts is known.
 */
export async function arReceiptEntries(
  db: Db,
  itemId: number
): Promise<{ entryId: number; date: string; docNo: string; amounts: ArAmounts; left: ArAmounts }[]> {
  const entries = await db.finArLedger.findMany({
    where: { item_id: itemId },
    orderBy: [{ entry_date: "asc" }, { id: "asc" }],
    select: { id: true, event: true, entry_date: true, doc_no: true, amount: true, dpp_movement: true, ppn_movement: true, pph_movement: true, source_entry_id: true },
  });
  const sources = entries.filter((e) => e.event === "Create" || e.event === "Received");
  return sources.map((s) => {
    const amounts = { gross: s.amount.toNumber(), dpp: s.dpp_movement.toNumber(), ppn: s.ppn_movement.toNumber(), pph: s.pph_movement.toNumber() };
    const left = { ...amounts };
    for (const d of entries.filter((e) => e.source_entry_id === s.id)) {
      left.gross += d.dpp_movement.toNumber() + d.ppn_movement.toNumber();
      left.dpp += d.dpp_movement.toNumber();
      left.ppn += d.ppn_movement.toNumber();
      left.pph += d.pph_movement.toNumber();
    }
    return { entryId: s.id, date: isoDay(s.entry_date), docNo: s.doc_no, amounts, left };
  });
}

/**
 * Where a document stands in the AR book, by its id — for the document's own
 * list and page, composed by the page layer: what was billed, what receipts
 * settled, and what is still open.
 */
export async function arDocumentPositions(
  type: ArItemType,
  sourceTable: string,
  ids: number[]
): Promise<Map<number, { billed: number; paid: number; open: number }>> {
  if (!ids.length) return new Map();
  const items = await openArItems(prisma, { type, sourceTable, sourceIds: ids });
  return new Map(items.map((i) => [i.source.docId, { billed: i.original.gross, paid: i.paid, open: i.open.gross }]));
}

// ------------------------------------------------------------------- reads

export type ArItemRow = {
  id: number;
  type: ArItemType;
  partnerId: number;
  partnerLabel: string;
  partnerName: string;
  date: string;
  dueDate: string | null;
  sourceNo: string;
  sourceTable: string;
  sourceId: number;
  orderNo: string | null;
  /** What came in up to the date asked about: the Terbentuk and every Diterima. */
  original: number;
  /** What left the item up to that date. */
  settled: number;
  /** Open at that date, and its DPP part. */
  open: number;
  openDpp: number;
};

/**
 * Every item of a type with a balance at the end of `asOf`, read from Buku
 * Piutang rather than the stored open figures, so a report for a past date is
 * right however much has moved since.
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
        select: { event: true, amount: true, movement: true, dpp_movement: true },
      },
    },
    orderBy: [{ item_date: "asc" }, { id: "asc" }],
  });
  return items
    .map((i) => {
      const original = i.entries
        .filter((e) => e.event === "Create" || e.event === "Received")
        .reduce((a, e) => a + e.amount.toNumber(), 0);
      const open = i.entries.reduce((a, e) => a + e.movement.toNumber(), 0);
      return {
        id: i.id,
        type: i.item_type as ArItemType,
        partnerId: i.partner_id,
        partnerLabel: i.partner.partner_label,
        partnerName: i.partner.partner_name,
        date: isoDay(i.item_date),
        dueDate: i.due_date ? isoDay(i.due_date) : null,
        sourceNo: i.source_no,
        sourceTable: i.source_doc_type.doc_table,
        sourceId: i.source_doc_id,
        orderNo: i.customer_order_no,
        original,
        settled: original - open,
        open,
        openDpp: i.entries.reduce((a, e) => a + e.dpp_movement.toNumber(), 0),
      };
    })
    .filter((r) => cents(r.open) !== 0);
}

export type ArLedgerEntryRow = {
  id: number;
  date: string;
  itemId: number;
  type: ArItemType;
  event: ArEvent;
  docNo: string;
  docTable: string;
  docId: number;
  /** The item's own identity: the document it is about. */
  itemSourceNo: string;
  orderNo: string | null;
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
  /** What each booked type holds at the end, as a positive figure. */
  closingByType: Record<"Advance" | "Invoice", number>;
};

/**
 * Buku Piutang of one customer over a period: every entry on their booked
 * items, oldest first, each signed on their Piutang Usaha position, with the
 * position before and after. A noted Tagihan is never in it: a request owed
 * nothing to anyone yet (P88).
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
    where: {
      item: { partner_id: partnerId, item_type: { in: AR_BOOKED_TYPES } },
      entry_date: { lte: asDate(range.to) },
    },
    include: {
      item: { select: { item_type: true, source_no: true, customer_order_no: true } },
      doc_type: { select: { doc_table: true } },
    },
    orderBy: [{ entry_date: "asc" }, { id: "asc" }],
  });
  const exposureOf = (r: (typeof rows)[number]) => r.movement.toNumber() * AR_SIGN[r.item.item_type as ArItemType];

  let opening = 0;
  const entries: ArLedgerEntryRow[] = [];
  const closingByType: Record<"Advance" | "Invoice", number> = { Advance: 0, Invoice: 0 };
  for (const r of rows) {
    closingByType[r.item.item_type as "Advance" | "Invoice"] += r.movement.toNumber();
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
      docNo: r.doc_no,
      docTable: r.doc_type.doc_table,
      docId: r.doc_id,
      itemSourceNo: r.item.source_no,
      orderNo: r.item.customer_order_no,
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

/** The customers that have ever had a booked AR item — the report's picker. */
export async function arPartnerOptions(): Promise<{ id: number; label: string; name: string; active: boolean }[]> {
  const rows = await prisma.mPartner.findMany({
    where: { ar_items: { some: { item_type: { in: AR_BOOKED_TYPES } } } },
    orderBy: { partner_label: "asc" },
    select: { id: true, partner_label: true, partner_name: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.partner_label, name: r.partner_name, active: true }));
}

/**
 * Whether every item's stored open figures — gross, DPP, PPN, PPh and base —
 * equal the sums of its entries. The stored figures are a convenience; the
 * entries are the record (P72).
 */
export async function arItemsReconcile(partnerId: number | null = null): Promise<boolean> {
  const items = await prisma.finArItem.findMany({
    where: partnerId ? { partner_id: partnerId } : {},
    select: {
      current_balance: true,
      current_dpp: true,
      current_ppn: true,
      current_pph: true,
      current_base_balance: true,
      entries: { select: { movement: true, dpp_movement: true, ppn_movement: true, pph_movement: true, base_movement: true } },
    },
  });
  const sum = (xs: Prisma.Decimal[]) => cents(xs.reduce((a, x) => a + x.toNumber(), 0));
  return items.every(
    (i) =>
      cents(i.current_balance.toNumber()) === sum(i.entries.map((e) => e.movement)) &&
      cents(i.current_dpp.toNumber()) === sum(i.entries.map((e) => e.dpp_movement)) &&
      cents(i.current_ppn.toNumber()) === sum(i.entries.map((e) => e.ppn_movement)) &&
      cents(i.current_pph.toNumber()) === sum(i.entries.map((e) => e.pph_movement)) &&
      cents(i.current_base_balance.toNumber()) === sum(i.entries.map((e) => e.base_movement))
  );
}
