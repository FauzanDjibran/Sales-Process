import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { formatNumber } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { lockPurchaseOrder, receiptNoteSources, recordPurchaseOrderReceived, type ReceiptNoteSource } from "./purchase-order";
import { InventoryRefusal, receiveStock, warehouseLocationOptions, type WarehouseLocationOption } from "./inventory";
import { fallbackAccounts } from "./system-settings";
import { accountsForItems } from "./item-account";
import {
  PURCHASE_RECEIPT,
  RECEIPT_NOTE_HOLDS_QTY,
  RECEIPT_NOTE_TRANSITIONS,
  cumulativeShare,
  receiptNoteIsEditable,
  receiptNoteTransitionAllowed,
  type ReceiptNoteAction,
  type ReceiptNoteStatus,
} from "./receipt-note-workflow";

/**
 * The Receipt Note module (P125, Purchasing-Concept.md B17–B22): its tables are
 * `log_receipt_note`, `log_receipt_note_line` and `log_receipt_note_lot`, and
 * nothing else names them.
 *
 * **Standalone** (P106): a purpose and a weak source pair, each line naming
 * its source line and carrying its own item, unit and factor. Its one purpose,
 * `purchase_receipt`, takes from one Open Purchase Order; one order may be
 * received in many notes, never beyond its lines. A **Barang with Kelola Stok**
 * comes in split into lots made here (B19); any other Barang and every **Jasa**
 * is an expense — a Jasa receipt is the service acceptance. Each line is worth
 * its cumulative share of the PO line's DPP (B20), PPN never entering stock or
 * expense. Posting writes the stock books through the inventory module and one
 * journal: Dr Persediaan / Beban, Cr Barang Diterima Belum Ditagih (B21, B22).
 *
 * The Purchase Order is read through `receiptNoteSources`, locked through
 * `lockPurchaseOrder` and told what came in through `recordPurchaseOrderReceived`.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type ReceiptNoteHeaderInput = {
  source_doc_id: number | null;
  rn_date: string;
  warehouse_id: number | null;
  supplier_dn_no: string;
  note: string;
};

/** One lot a line comes in as — and, in a warehouse with Gunakan Lokasi, where it is put. */
export type ReceiptNoteLotInput = { lot_no: string; expiry_date: string; location_id?: number | null; qty: number | string };

export type ReceiptNoteLineInput = {
  source_doc_line_id: number | null;
  qty: number | string;
  note: string;
  /** Only for a Kelola Stok line. */
  lots?: ReceiptNoteLotInput[];
};

export type ReceiptNoteResult = { ok: true; id: number; rnNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const num = (v: unknown) => Number(String(v ?? "").replace(",", "."));

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/** What other notes — Draft or Posted, not `exceptId` — hold of each PO line. */
async function heldByLines(db: Db, lineIds: number[], exceptId: number | null): Promise<Map<number, number>> {
  if (!lineIds.length) return new Map();
  const rows = await db.logReceiptNoteLine.groupBy({
    by: ["source_doc_line_id"],
    where: {
      source_doc_line_id: { in: lineIds },
      receipt_note: { purpose: PURCHASE_RECEIPT, status: { in: RECEIPT_NOTE_HOLDS_QTY }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.source_doc_line_id, r._sum?.qty?.toNumber() ?? 0]));
}

// ---------------------------------------------------------------- options

export type RnSourceLine = ReceiptNoteSource["lines"][number] & { held: number };
export type RnSourceOption = Omit<ReceiptNoteSource, "lines"> & { lines: RnSourceLine[] };

export type ReceiptNoteOptions = {
  orders: RnSourceOption[];
  warehouses: {
    id: number;
    label: string;
    name: string;
    active: boolean;
    /** Gunakan Lokasi: each lot row names one of `locations`. */
    useLocation: boolean;
    locations: WarehouseLocationOption[];
  }[];
};

async function sourceOptions(db: Db, filter: { ids?: number[]; openOnly?: boolean }, exceptId: number | null): Promise<RnSourceOption[]> {
  const sources = await receiptNoteSources(filter, db);
  const held = await heldByLines(db, sources.flatMap((s) => s.lines.map((l) => l.id)), exceptId);
  return sources.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, held: held.get(l.id) ?? 0 })) }));
}

/** Open Purchase Orders with something left to receive, or the one a stored note names. */
export async function receiptNoteOptions(current: { id: number; sourceId: number } | null = null): Promise<ReceiptNoteOptions> {
  const [orders, warehouses] = await Promise.all([
    current
      ? sourceOptions(prisma, { ids: [current.sourceId] }, current.id)
      : sourceOptions(prisma, { openOnly: true }, null).then((os) => os.filter((o) => o.lines.some((l) => units(l.qty) > units(l.held)))),
    prisma.refWarehouse.findMany({ orderBy: { warehouse_label: "asc" } }),
  ]);
  const locations = await warehouseLocationOptions(warehouses.filter((w) => w.use_location).map((w) => w.id));
  return {
    orders,
    warehouses: warehouses.map((w) => ({
      id: w.id,
      label: w.warehouse_label,
      name: w.warehouse_name,
      active: w.status === "Active",
      useLocation: w.use_location,
      locations: locations.get(w.id) ?? [],
    })),
  };
}

// ------------------------------------------------------------- validation

type CheckedLot = { lot_seq: number; lot_no: string | null; expiry_date: Date | null; location_id: number | null; qty: number };

/** Where a receipt's lots may be put: nothing to choose, or one of the warehouse's locations. */
type Place = { useLocation: boolean; locations: Map<number, WarehouseLocationOption> };
type CheckedLine = {
  line_no: number;
  source_doc_line_id: number;
  item_id: number;
  uom_id: number;
  uom_factor: number;
  qty: number;
  base_qty: number;
  is_stock: boolean;
  note: string | null;
  lots: CheckedLot[];
};
type Checked = {
  source: RnSourceOption;
  data: {
    purpose: string;
    source_doc_type_id: number;
    source_doc_id: number;
    source_no: string;
    partner_id: number;
    warehouse_id: number | null;
    rn_date: Date;
    supplier_dn_no: string | null;
    note: string | null;
  };
  lines: CheckedLine[];
};

/**
 * Every rule a Receipt Note must satisfy to be saved — and, run again inside
 * the posting transaction with the Purchase Order locked and `forPosting`, to
 * be posted. A Draft's lots may be partial; posting needs them in full.
 */
export async function checkReceiptNote(
  db: Db,
  header: ReceiptNoteHeaderInput,
  lines: ReceiptNoteLineInput[],
  selfId: number | null,
  forPosting = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const poId = Number(header.source_doc_id) || null;
  const source = poId ? (await sourceOptions(db, { ids: [poId] }, selfId))[0] : undefined;
  if (!poId) errors.source_doc_id = "Pilih Purchase Order.";
  else if (!source) errors.source_doc_id = "Purchase Order tidak ditemukan.";
  else if (source.status !== "Open") errors.source_doc_id = "Purchase Order harus berstatus Open.";
  else if (!source.supplierActive) errors.source_doc_id = "Supplier pada Purchase Order ini sudah nonaktif.";

  const rnDate = String(header.rn_date ?? "").trim();
  if (!DAY.test(rnDate)) errors.rn_date = "Tanggal terima wajib diisi.";
  else if (source && rnDate < source.orderDate) errors.rn_date = "Tidak boleh sebelum tanggal Purchase Order.";

  // A Barang receipt names where the goods come in; a Jasa receipt has none.
  let warehouseId: number | null = null;
  const place: Place = { useLocation: false, locations: new Map() };
  if (source?.itemType === "Barang") {
    warehouseId = Number(header.warehouse_id) || null;
    if (!warehouseId) errors.warehouse_id = "Pilih Gudang.";
    else {
      const w = await db.refWarehouse.findUnique({ where: { id: warehouseId }, select: { status: true, use_location: true } });
      if (!w || w.status !== "Active") errors.warehouse_id = "Gudang tidak ditemukan atau nonaktif.";
      else if (w.use_location) {
        place.useLocation = true;
        place.locations = new Map((await warehouseLocationOptions([warehouseId], db)).get(warehouseId)?.map((l) => [l.id, l]) ?? []);
      }
    }
  }

  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu baris.";
  const byId = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const seen = new Set<number>();
  const out: CheckedLine[] = [];
  for (const [i, l] of raw.entries()) {
    const lineId = Number(l.source_doc_line_id) || null;
    const po = lineId ? byId.get(lineId) : undefined;
    if (!po) {
      if (source) errors[lineKey(i, "source_doc_line_id")] = "Baris bukan bagian Purchase Order ini.";
      continue;
    }
    if (seen.has(po.id)) {
      errors[lineKey(i, "source_doc_line_id")] = `${po.itemLabel} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(po.id);
    const qty = num(l.qty);
    const left = fromUnits(units(po.qty) - units(po.held));
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    // No over-receipt (B18): more than ordered is a change to the PO.
    if (units(qty) > units(left)) {
      errors[lineKey(i, "qty")] = `Melebihi sisa Purchase Order (${qtyText(left)} ${po.uomLabel}).`;
      continue;
    }
    const lots = checkLots(l.lots, po, fromUnits(units(qty)), place, forPosting);
    if (!lots.ok) {
      errors[lineKey(i, "lots")] = lots.error;
      continue;
    }
    out.push({
      line_no: out.length + 1,
      source_doc_line_id: po.id,
      item_id: po.itemId,
      uom_id: po.uomId,
      uom_factor: po.uomFactor,
      qty: fromUnits(units(qty)),
      base_qty: fromUnits(units(qty * po.uomFactor)),
      is_stock: po.isStock,
      note: text(l.note),
      lots: lots.lots,
    });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length || !source) return { ok: false, errors };
  return {
    ok: true,
    c: {
      source,
      data: {
        purpose: PURCHASE_RECEIPT,
        source_doc_type_id: await docTypeId(db, "pur_order"),
        source_doc_id: source.id,
        source_no: source.orderNo,
        partner_id: source.supplierId,
        warehouse_id: warehouseId,
        rn_date: asDate(rnDate),
        supplier_dn_no: text(header.supplier_dn_no),
        note: text(header.note),
      },
      lines: out,
    },
  };
}

/**
 * A line's lots (B19). A Kelola Stok line comes in as one or more lots, each
 * more than 0, an expiry where the item has one; together never more than the
 * line, and to be posted exactly the line. Any other line takes none. In a
 * warehouse with Gunakan Lokasi each lot row names one of its active locations
 * (a Draft may leave it empty; posting may not), and one lot may be split over
 * several locations, once in each.
 */
function checkLots(
  raw: ReceiptNoteLotInput[] | undefined,
  line: RnSourceLine,
  lineQty: number,
  place: Place,
  forPosting: boolean
): { ok: true; lots: CheckedLot[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (!line.isStock) return list.length ? { ok: false, error: `${line.itemLabel} tidak dikelola stok, jadi tidak memakai lot.` } : { ok: true, lots: [] };
  const seen = new Set<string>();
  const lots: CheckedLot[] = [];
  let total = 0;
  for (const p of list) {
    const lotNo = String(p.lot_no ?? "").trim().toUpperCase() || null;
    const locationId = Number(p.location_id) || null;
    const location = locationId ? place.locations.get(locationId) : undefined;
    if (!place.useLocation && locationId) return { ok: false, error: "Gudang ini tidak memakai lokasi." };
    if (locationId && !location) return { ok: false, error: "Lokasi tidak ada di gudang ini. Pilih ulang lokasinya." };
    if (location && !location.active) return { ok: false, error: `Lokasi ${location.label} nonaktif.` };
    if (place.useLocation && !locationId && forPosting) return { ok: false, error: `${line.itemLabel}: pilih lokasi setiap lot.` };
    const key = `${lotNo}:${locationId ?? 0}`;
    if (lotNo && seen.has(key)) return { ok: false, error: `Lot ${lotNo}${location ? ` di ${location.label}` : ""} diisi lebih dari sekali.` };
    if (lotNo) seen.add(key);
    const qty = num(p.qty);
    if (!Number.isFinite(qty) || !(qty > 0)) return { ok: false, error: "Isi jumlah setiap lot lebih dari 0." };
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) return { ok: false, error: "Jumlah lot paling banyak 4 angka desimal." };
    const expiry = String(p.expiry_date ?? "").trim();
    if (expiry && !DAY.test(expiry)) return { ok: false, error: "Tanggal kadaluarsa tidak valid." };
    if (line.hasExpiry && !expiry && forPosting) return { ok: false, error: `${line.itemLabel} memiliki kadaluarsa: isi tanggal kadaluarsa setiap lot.` };
    total += units(qty);
    lots.push({ lot_seq: lots.length + 1, lot_no: lotNo, expiry_date: expiry ? asDate(expiry) : null, location_id: locationId, qty: fromUnits(units(qty)) });
  }
  if (total > units(lineQty)) return { ok: false, error: `Jumlah lot (${qtyText(fromUnits(total))}) melebihi Qty baris (${qtyText(lineQty)} ${line.uomLabel}).` };
  if (forPosting && total !== units(lineQty)) {
    return { ok: false, error: `${line.itemLabel}: lot baru ${qtyText(fromUnits(total))} dari ${qtyText(lineQty)} ${line.uomLabel}. Lengkapi lotnya.` };
  }
  return { ok: true, lots };
}

// ------------------------------------------------------------------ writes

async function nextRnNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("RN", isTaxable), date, async (series) => {
    const row = await db.logReceiptNote.findFirst({ where: { rn_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { rn_no: true } });
    return row?.rn_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "log_receipt_note", row_id: id, action, event, by } });
}

class Refused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("refused");
  }
}

async function refusable<T>(run: () => Promise<T>): Promise<T | { ok: false; errors: Record<string, string> }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    if (e instanceof InventoryRefusal) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

const lineCreate = ({ lots, ...l }: CheckedLine) => ({ ...l, lots: { create: lots } });

export async function createReceiptNote(header: ReceiptNoteHeaderInput, lines: ReceiptNoteLineInput[], actorId: number): Promise<ReceiptNoteResult> {
  const sourceId = Number(header.source_doc_id) || null;
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      if (sourceId) await lockPurchaseOrder(tx, sourceId);
      const r = await checkReceiptNote(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.logReceiptNote.create({
        data: {
          ...r.c.data,
          // A receipt follows its Purchase Order's series (P109).
          rn_no: await nextRnNo(tx, r.c.data.rn_date, r.c.source.isTaxable),
          created_by: actorId,
          lines: { create: r.c.lines.map(lineCreate) },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, rnNo: made.rn_no };
  });
}

export async function updateReceiptNote(id: number, header: ReceiptNoteHeaderInput, lines: ReceiptNoteLineInput[], actorId: number): Promise<ReceiptNoteResult> {
  const current = await prisma.logReceiptNote.findUnique({ where: { id }, select: { status: true, rn_no: true, source_doc_id: true } });
  if (!current) return { ok: false, errors: { _form: "Receipt Note tidak ditemukan." } };
  if (!receiptNoteIsEditable(current.status as ReceiptNoteStatus)) return { ok: false, errors: { _form: "Receipt Note yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  if (Number(header.source_doc_id) !== current.source_doc_id) {
    return { ok: false, errors: { source_doc_id: "Purchase Order tidak dapat diganti. Buat Receipt Note baru untuk Purchase Order lain." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockPurchaseOrder(tx, current.source_doc_id);
      const r = await checkReceiptNote(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.logReceiptNote.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Receipt Note berubah saat diproses. Muat ulang halaman." });
      await tx.logReceiptNoteLine.deleteMany({ where: { receipt_note_id: id } });
      for (const l of r.c.lines) await tx.logReceiptNoteLine.create({ data: { ...lineCreate(l), receipt_note_id: id } });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, rnNo: current.rn_no };
  });
}

type StoredNote = Prisma.LogReceiptNoteGetPayload<{ include: { lines: { include: { lots: true } } } }>;
const WITH_LOTS = { lines: { include: { lots: { orderBy: { lot_seq: "asc" as const } } }, orderBy: { line_no: "asc" as const } } };

function asInput(n: StoredNote): { header: ReceiptNoteHeaderInput; lines: ReceiptNoteLineInput[] } {
  return {
    header: {
      source_doc_id: n.source_doc_id,
      rn_date: isoDay(n.rn_date),
      warehouse_id: n.warehouse_id,
      supplier_dn_no: n.supplier_dn_no ?? "",
      note: n.note ?? "",
    },
    lines: [...n.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        source_doc_line_id: l.source_doc_line_id,
        qty: l.qty.toNumber(),
        note: l.note ?? "",
        lots: l.lots.map((p) => ({ lot_no: p.lot_no ?? "", expiry_date: isoDay(p.expiry_date), location_id: p.location_id, qty: p.qty.toNumber() })),
      })),
  };
}

// --------------------------------------------------------------- posting

/** The journal Posting would write now — Posting run as a dry run and rolled back (P103). */
export async function receiptNotePreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionReceiptNote(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

export type ReceiptNoteTransitionResult =
  | { ok: true; closed?: string[]; journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Posting**, in one transaction with the Purchase
 * Order locked: checks the stored note again, values each line at its
 * cumulative share of the PO line's DPP after what posted receipts brought in
 * (B20) and each lot at its share of the line, brings the Kelola Stok lots in
 * through `receiveStock` — a lot left without a number is numbered after the
 * note — writes Dr Persediaan / Beban per item's Kategori Item, Cr Barang
 * Diterima Belum Ditagih naming the supplier, dated Tanggal Terima, and tells
 * the Purchase Order what came in, which may close it. **Batalkan** (Draft
 * only) asks for a reason and writes nothing else.
 */
export async function transitionReceiptNote(
  id: number,
  action: ReceiptNoteAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean } = {}
): Promise<ReceiptNoteTransitionResult> {
  const note = await prisma.logReceiptNote.findUnique({ where: { id }, include: WITH_LOTS });
  if (!note) return { ok: false, errors: { _form: "Receipt Note tidak ditemukan." } };
  const t = RECEIPT_NOTE_TRANSITIONS[action];
  if (!receiptNoteTransitionAllowed(action, note.status as ReceiptNoteStatus)) {
    return { ok: false, errors: { _form: `Receipt Note berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Receipt Note berubah saat diproses. Muat ulang halaman.";

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.logReceiptNote.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(note.rn_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  // Stock lines to the category's Persediaan (Account Mapping's where none);
  // any other line to the category's Beban, which has no fallback (P122).
  const fallback = await fallbackAccounts(["inventory_account", "goods_received_account"] as const);
  if (!fallback.goods_received_account) return { ok: false, errors: { _form: "Lengkapi Account Mapping dulu: Account Barang Diterima Belum Ditagih." } };
  const byCategory = await accountsForItems([...new Set(note.lines.map((l) => l.item_id))]);
  const items = new Map((await prisma.mItem.findMany({ where: { id: { in: [...byCategory.keys()] } }, select: { id: true, item_label: true } })).map((i) => [i.id, i.item_label]));
  const debitOf = new Map<number, number>();
  for (const l of note.lines) {
    const c = byCategory.get(l.item_id);
    const account = l.is_stock ? (c?.inventory ?? fallback.inventory_account) : (c?.expense ?? null);
    if (!account) {
      const what = l.is_stock ? "Account Persediaan" : "Account Beban";
      return { ok: false, errors: { _form: `Lengkapi Account Kategori Item dulu: ${what} untuk kategori barang ${items.get(l.item_id) ?? ""}.` } };
    }
    debitOf.set(l.item_id, account);
  }
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    const closed = await prisma.$transaction(async (tx) => {
      await lockPurchaseOrder(tx, note.source_doc_id);
      const input = asInput(note);
      const r = await checkReceiptNote(tx, input.header, input.lines, id, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const done = await tx.logReceiptNote.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const typeId = await docTypeId(tx, "log_receipt_note");
      const source = { docTypeId: typeId, docId: id, no: note.rn_no };
      const byId = new Map(r.c.source.lines.map((l) => [l.id, l]));
      const journalLines: JournalLineInput[] = [];
      const received = new Map<number, number>();
      let total = 0;
      for (const line of r.c.lines) {
        const po = byId.get(line.source_doc_line_id)!;
        const value = cumulativeShare(po.dpp, po.qty, po.received, line.qty);
        const stored = await tx.logReceiptNoteLine.findUniqueOrThrow({
          where: { receipt_note_id_source_doc_line_id: { receipt_note_id: id, source_doc_line_id: line.source_doc_line_id } },
          select: { id: true },
        });
        if (line.is_stock) {
          let before = 0;
          for (const lot of line.lots) {
            const lotValue = cumulativeShare(value, line.qty, before, lot.qty);
            before += lot.qty;
            const baseQty = fromUnits(units(lot.qty * line.uom_factor));
            const lotNo = lot.lot_no ?? `${note.rn_no.replace(/[^A-Z0-9]/gi, "")}-${line.line_no}-${lot.lot_seq}`;
            const inn = await receiveStock(tx, {
              itemId: line.item_id,
              warehouseId: r.c.data.warehouse_id!,
              locationId: lot.location_id,
              lotNo,
              expiry: lot.expiry_date,
              baseQty,
              value: lotValue,
              date: r.c.data.rn_date,
              source,
              partnerId: r.c.data.partner_id,
              actorId,
            });
            await tx.logReceiptNoteLot.update({
              where: { line_id_lot_seq: { line_id: stored.id, lot_seq: lot.lot_seq } },
              data: { lot_no: inn.trackingNo, base_qty: baseQty, value_amount: lotValue, tracking_id: inn.trackingId },
            });
          }
        }
        await tx.logReceiptNoteLine.update({ where: { id: stored.id }, data: { value_amount: value } });
        received.set(line.source_doc_line_id, line.qty);
        total += value;
        if (value > 0) {
          const what = `${po.itemLabel} · ${qtyText(line.qty)} ${po.uomLabel}`;
          journalLines.push({
            accountId: debitOf.get(line.item_id)!,
            currencyId: baseCurrency.id,
            rate: 1,
            debit: value,
            credit: 0,
            description: `${line.is_stock ? "Masuk" : "Beban"} ${what}`,
          });
        }
      }
      if (total > 0) {
        journalLines.push({
          accountId: fallback.goods_received_account!,
          currencyId: baseCurrency.id,
          rate: 1,
          debit: 0,
          credit: total,
          partnerId: r.c.data.partner_id,
          description: `Diterima belum ditagih · ${r.c.source.orderNo}`,
        });
      }
      const journal = !journalLines.length ? null : await postJournal(tx, {
        description: `${note.rn_no} · Penerimaan ${r.c.source.orderNo} — ${r.c.source.supplierName}`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: r.c.data.rn_date,
        actorId,
        lines: journalLines,
      });
      await tx.logReceiptNote.update({ where: { id }, data: { journal_id: journal?.id ?? null, value_amount: total } });
      await audit(tx, id, "UPDATE", "post", actorId);
      const closed = await recordPurchaseOrderReceived(tx, received, actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
      return closed;
    });
    return { ok: true as const, closed };
  });
}

/** Why a Purchase Order may not be closed yet: a Receipt Note on it is still Draft. */
export async function liveReceiptNoteRefusal(tx: Prisma.TransactionClient, purchaseOrderId: number): Promise<string | null> {
  const live = await tx.logReceiptNote.findMany({
    where: { purpose: PURCHASE_RECEIPT, source_doc_id: purchaseOrderId, status: "Draft" },
    orderBy: { id: "asc" },
    select: { rn_no: true },
  });
  if (!live.length) return null;
  return `Masih ada Receipt Note Draft: ${live.map((n) => n.rn_no).slice(0, 3).join(", ")}. Posting atau batalkan dulu.`;
}

// ------------------------------------------------------------------- reads

export type ReceiptNoteListRow = {
  id: number;
  rnNo: string;
  rnDate: string;
  status: ReceiptNoteStatus;
  sourceId: number;
  sourceNo: string;
  supplierLabel: string;
  supplierName: string;
  warehouseLabel: string | null;
  lines: number;
  value: number;
};

export async function listReceiptNotes(): Promise<ReceiptNoteListRow[]> {
  const rows = await prisma.logReceiptNote.findMany({
    orderBy: [{ rn_date: "desc" }, { id: "desc" }],
    include: { partner: true, warehouse: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    rnNo: r.rn_no,
    rnDate: isoDay(r.rn_date),
    status: r.status as ReceiptNoteStatus,
    sourceId: r.source_doc_id,
    sourceNo: r.source_no,
    supplierLabel: r.partner.partner_label,
    supplierName: r.partner.partner_name,
    warehouseLabel: r.warehouse?.warehouse_label ?? null,
    lines: r._count.lines,
    value: r.value_amount.toNumber(),
  }));
}

export type ReceiptNoteView = {
  id: number;
  rnNo: string;
  status: ReceiptNoteStatus;
  header: ReceiptNoteHeaderInput;
  lines: (ReceiptNoteLineInput & { id: number; baseQty: number; value: number; isStock: boolean; lotValues: number[] })[];
  value: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
};

export async function getReceiptNote(id: number): Promise<ReceiptNoteView | null> {
  const n = await prisma.logReceiptNote.findUnique({ where: { id }, include: WITH_LOTS });
  if (!n) return null;
  const input = asInput(n);
  const journalNo = n.journal_id ? ((await journalNumbersByIds([n.journal_id])).get(n.journal_id) ?? null) : null;
  return {
    id: n.id,
    rnNo: n.rn_no,
    status: n.status as ReceiptNoteStatus,
    header: input.header,
    lines: input.lines.map((l, i) => ({
      ...l,
      id: n.lines[i].id,
      baseQty: n.lines[i].base_qty.toNumber(),
      value: n.lines[i].value_amount.toNumber(),
      isStock: n.lines[i].is_stock,
      lotValues: n.lines[i].lots.map((p) => p.value_amount.toNumber()),
    })),
    value: n.value_amount.toNumber(),
    journalId: n.journal_id,
    journalNo,
    cancelReason: n.cancel_reason,
  };
}

/**
 * For the Gudang master (Gunakan Lokasi): how many Draft Receipt Notes bring
 * goods into the warehouse, and which of the locations named a lot row of any
 * note puts goods in.
 */
export async function receiptNoteLocationUse(warehouseId: number, locationIds: number[]): Promise<{ drafts: number; named: Set<number> }> {
  const [drafts, named] = await Promise.all([
    prisma.logReceiptNote.count({ where: { warehouse_id: warehouseId, status: "Draft" } }),
    locationIds.length
      ? prisma.logReceiptNoteLot.findMany({ where: { location_id: { in: locationIds } }, distinct: ["location_id"], select: { location_id: true } })
      : [],
  ]);
  return { drafts, named: new Set(named.flatMap((r) => (r.location_id ? [r.location_id] : []))) };
}

export async function receiptNoteNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logReceiptNote.findMany({ where: { id: { in: ids } }, select: { id: true, rn_no: true } });
  return new Map(rows.map((r) => [r.id, r.rn_no]));
}

/** A Purchase Order's receipts, for its own page. */
export async function purchaseOrderReceipts(purchaseOrderId: number): Promise<{ id: number; rnNo: string; rnDate: string; status: ReceiptNoteStatus }[]> {
  const rows = await prisma.logReceiptNote.findMany({
    where: { purpose: PURCHASE_RECEIPT, source_doc_id: purchaseOrderId },
    orderBy: [{ rn_date: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ id: r.id, rnNo: r.rn_no, rnDate: isoDay(r.rn_date), status: r.status as ReceiptNoteStatus }));
}

// ---------------------------------------------- for the Invoice Pembelian

/**
 * A Receipt Note line as an Invoice Pembelian reads it (B28): a quantity of one
 * PO line received on a posted note, and what it was valued at — the PO's DPP
 * for that quantity, which the invoice bills (B29a). A posted note never
 * changes, so what an invoice bills does not move.
 */
export type ApInvoiceSourceLine = {
  id: number;
  receiptNoteId: number;
  rnNo: string;
  rnDate: string;
  status: ReceiptNoteStatus;
  purchaseOrderId: number;
  purchaseOrderLineId: number;
  qty: number;
  value: number;
};

/** Every posted receipt line, ids only, with its PO — to find the POs with something to bill. */
export async function postedReceiptLineIds(db: Db = prisma): Promise<{ id: number; purchaseOrderId: number }[]> {
  const rows = await db.logReceiptNoteLine.findMany({
    where: { receipt_note: { purpose: PURCHASE_RECEIPT, status: "Posted" } },
    select: { id: true, receipt_note: { select: { source_doc_id: true } } },
  });
  return rows.map((r) => ({ id: r.id, purchaseOrderId: r.receipt_note.source_doc_id }));
}

/** Lines of the POs' posted notes, or the lines named whatever their note's status. */
export async function apInvoiceSourceLines(filter: { orderIds?: number[]; lineIds?: number[] }, db: Db = prisma): Promise<ApInvoiceSourceLine[]> {
  const rows = await db.logReceiptNoteLine.findMany({
    where: filter.lineIds
      ? { id: { in: filter.lineIds } }
      : { receipt_note: { purpose: PURCHASE_RECEIPT, status: "Posted", source_doc_id: { in: filter.orderIds ?? [] } } },
    include: { receipt_note: true },
    orderBy: [{ receipt_note: { rn_date: "asc" } }, { receipt_note_id: "asc" }, { line_no: "asc" }],
  });
  return rows.map((l) => ({
    id: l.id,
    receiptNoteId: l.receipt_note_id,
    rnNo: l.receipt_note.rn_no,
    rnDate: isoDay(l.receipt_note.rn_date),
    status: l.receipt_note.status as ReceiptNoteStatus,
    purchaseOrderId: l.receipt_note.source_doc_id,
    purchaseOrderLineId: l.source_doc_line_id,
    qty: l.qty.toNumber(),
    value: l.value_amount.toNumber(),
  }));
}
