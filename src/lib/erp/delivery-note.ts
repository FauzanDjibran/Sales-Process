import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { formatNumber } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate, holdPostingPeriod, PeriodShut } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { customerOrderNumbersByIds } from "./customer-order";
import {
  customerOrderIdsOfDeliveryOrders,
  deliveryOrderIdsOfCustomerOrders,
  deliveryNoteSources,
  lockDeliveryOrderScope,
  recordDeliveryOrderDelivery,
  type DeliveryNoteSource,
  type DeliveryNoteSourceLine,
} from "./delivery-order";
import { DEFAULT_DELIVERY_NOTE_PURPOSE, deliveryNotePurpose } from "./delivery-note-purposes";
import { InventoryRefusal, issueStock, locationLabelsByIds, lotOptions, lotTrackedItems, type LotOption } from "./inventory";
import { fallbackAccounts } from "./system-settings";
import { accountsForItems } from "./item-account";
import {
  DELIVERY_NOTE_HOLDS_QTY,
  DELIVERY_NOTE_TRANSITIONS,
  deliveryNoteIsEditable,
  deliveryNoteTransitionAllowed,
  type DeliveryNoteAction,
  type DeliveryNoteStatus,
} from "./delivery-note-workflow";

/**
 * The Delivery Note module (P106; C28, U11–U15): its tables are
 * `log_delivery_note`, `log_delivery_note_line` and `log_delivery_note_tracking`,
 * and nothing else names them.
 *
 * **Standalone** (P106): the note belongs to no business module. Its purpose
 * (`delivery-note-purposes.ts`) says what its source is; the source is named by
 * the weak pair `source_doc_type_id` / `source_doc_id`, each line by
 * `source_doc_line_id`, and each line carries its own item, unit and factor.
 * Quantity and stock cost only — never a price or tax. The one purpose so far is
 * `sales_delivery`, described below; a purchase return will be the next.
 *
 * A Delivery Note is the document the goods leave on. It is made from one
 * issued Delivery Order — whose Customer Order, customer, warehouse and address
 * it copies — and takes a quantity of some of its lines; a Delivery Order may
 * be sent in several notes, never more than its lines in total. A Barang with
 * Kelola Stok is picked by bucket on the note (U15): lot, location and stock
 * status, in the item's base unit. **The tracking row is the detail and holds
 * the value; the line is its summary** (P268): the stock owns the value, so
 * what each bucket released is stored on its tracking row and the line keeps
 * only the sum. Posting issues every tracking row through the inventory module,
 * then runs **its purpose's own posting** (`PURPOSE_POSTING`): for a sale,
 * Dr HPP / Cr Persediaan and what left written back to the Delivery Order.
 * **Cost of goods only** — Piutang is born at the Invoice, which will take this
 * note's lines whole.
 *
 * The Delivery Order is read through `deliveryNoteSources` and told what left
 * through `recordDeliveryOrderDelivery`; its Customer Order is locked through
 * `lockDeliveryOrderScope`, the same lock every document on the order takes.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** The purpose this module serves today (P106). */
const SALES_DELIVERY = "sales_delivery";

// ------------------------------------------------------------------ input

export type DeliveryNoteHeaderInput = {
  /** The purpose's key (P106); `sales_delivery` when omitted. */
  purpose?: string;
  /** The source document: for `sales_delivery` a Delivery Order. */
  source_doc_id: number | null;
  dn_date: string;
  vehicle_no: string;
  driver_name: string;
  note: string;
};

/**
 * One bucket a line takes goods from — the stock picking (U15, P268): a lot,
 * the location it is taken from in a warehouse that has locations, and its
 * stock status, counted in the item's base unit.
 */
export type DeliveryNotePickInput = {
  tracking_id: number | null;
  location_id?: number | null;
  stock_status_id?: number | null;
  base_qty: number | string;
};

export type DeliveryNoteLineInput = {
  /** The source line: for `sales_delivery` a Delivery Order line. */
  source_doc_line_id: number | null;
  qty: number | string;
  note: string;
  /** Only for an item with Kelola Stok; empty for any other. */
  picks?: DeliveryNotePickInput[];
};

export type DeliveryNoteResult = { ok: true; id: number; dnNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;

/** Quantities are `Decimal(18, 4)`, compared in ten-thousandths. */
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

// ------------------------------------------------------------- quantities

/**
 * What other notes of the purpose — Draft or Posted, but not `exceptId` — hold
 * of each source line. Source line ids are only unique within a purpose's
 * source table, so the purpose is part of the question.
 */
async function heldByLines(db: Db, purpose: string, lineIds: number[], exceptId: number | null): Promise<Map<number, number>> {
  if (!lineIds.length) return new Map();
  const rows = await db.logDeliveryNoteLine.groupBy({
    by: ["source_doc_line_id"],
    where: {
      source_doc_line_id: { in: lineIds },
      delivery_note: { purpose, status: { in: DELIVERY_NOTE_HOLDS_QTY }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.source_doc_line_id, r._sum?.qty?.toNumber() ?? 0]));
}

// ---------------------------------------------------------------- options

export type DnSourceLine = DeliveryNoteSourceLine & {
  /** What other Delivery Notes hold of this line — sent or reserved by a Draft. */
  held: number;
  /** The item leaves by lot (Kelola Stok, U15): the line must be picked. */
  lotTracked: boolean;
  /** The item's base unit: what its tracking rows are counted in (P268). */
  baseUomLabel: string;
};

export type DnSourceOption = Omit<DeliveryNoteSource, "lines"> & {
  lines: DnSourceLine[];
  /** The lots each lot-tracked item may be picked from in this order's warehouse, by item id, earliest expiry first. */
  lots: Record<number, LotOption[]>;
};

export type DeliveryNoteOptions = { orders: DnSourceOption[] };

async function sourceOptions(
  db: Db,
  filter: { ids?: number[]; issuedOnly?: boolean },
  exceptId: number | null,
  /** Lots a stored note already names, kept readable whatever their status. */
  withLotIds: number[] = []
): Promise<DnSourceOption[]> {
  const sources = await deliveryNoteSources(filter, db);
  const held = await heldByLines(db, SALES_DELIVERY, sources.flatMap((s) => s.lines.map((l) => l.id)), exceptId);
  const itemIds = [...new Set(sources.flatMap((s) => s.lines.map((l) => l.itemId)))];
  const [tracked, baseUoms] = await Promise.all([
    lotTrackedItems(itemIds, db),
    db.mItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, base_uom: { select: { uom_label: true } } } }),
  ]);
  const baseUomOf = new Map(baseUoms.map((i) => [i.id, i.base_uom.uom_label]));
  // Every source's lots in one read, keyed by warehouse, instead of one per source.
  const lotsByWarehouse = await lotOptions(
    itemIds.filter((id) => tracked.has(id)),
    [...new Set(sources.map((s) => s.warehouseId))],
    db,
    withLotIds,
    deliveryNotePurpose(SALES_DELIVERY)!.statusLabels
  );
  const out: DnSourceOption[] = [];
  for (const s of sources) {
    const lotItems = new Set(s.lines.map((l) => l.itemId).filter((id) => tracked.has(id)));
    const lots = new Map([...(lotsByWarehouse.get(s.warehouseId) ?? new Map<number, LotOption[]>()).entries()].filter(([item]) => lotItems.has(item)));
    out.push({
      ...s,
      lines: s.lines.map((l) => ({
        ...l,
        held: held.get(l.id) ?? 0,
        lotTracked: tracked.has(l.itemId),
        baseUomLabel: baseUomOf.get(l.itemId) ?? l.uomLabel,
      })),
      lots: Object.fromEntries([...lots.entries()]),
    });
  }
  return out;
}

/**
 * What the form offers: every issued Delivery Order with something left to
 * send. `current` is the note being edited or shown — its own Delivery Order is
 * always included, whatever its status, and its own lines never count against
 * the room.
 */
export async function deliveryNoteOptions(
  current: { id: number; sourceId: number; lotIds?: number[] } | null = null
): Promise<DeliveryNoteOptions> {
  // A saved note's Delivery Order is locked: its page needs only that one.
  if (current) return { orders: await sourceOptions(prisma, { ids: [current.sourceId] }, current.id, current.lotIds ?? []) };
  const issued = (await sourceOptions(prisma, { issuedOnly: true }, null)).filter((o) => o.lines.some((l) => units(l.qty) > units(l.held)));
  return { orders: issued };
}

// ------------------------------------------------------------- validation

type CheckedPick = {
  pick_no: number;
  tracking_id: number;
  location_id: number | null;
  stock_status_id: number;
  tracking_no: string;
  expiry_date: Date | null;
  base_qty: number;
};

type CheckedLine = {
  line_no: number;
  source_doc_line_id: number;
  item_id: number;
  uom_id: number;
  uom_factor: number;
  qty: number;
  base_qty: number;
  note: string | null;
  picks: CheckedPick[];
};

type Checked = {
  source: DnSourceOption;
  data: {
    purpose: string;
    source_doc_type_id: number;
    source_doc_id: number;
    source_no: string;
    partner_id: number;
    warehouse_id: number;
    address_id: number;
    dn_date: Date;
    vehicle_no: string | null;
    driver_name: string | null;
    note: string | null;
  };
  lines: CheckedLine[];
};

/**
 * Every rule a Delivery Note must satisfy to be saved — and, run again inside
 * the posting transaction with the Customer Order locked and `forPosting`, to
 * be posted. A Draft may be picked in part; posting needs every lot-tracked
 * line picked in full (U15).
 */
export async function checkDeliveryNote(
  db: Db,
  header: DeliveryNoteHeaderInput,
  lines: DeliveryNoteLineInput[],
  selfId: number | null,
  forPosting = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  // The only purpose so far; a second one brings its own source reader here.
  const purpose = deliveryNotePurpose(header.purpose ?? DEFAULT_DELIVERY_NOTE_PURPOSE);
  if (purpose?.key !== SALES_DELIVERY) return { ok: false, errors: { purpose: "Tujuan Delivery Note tidak dikenal." } };

  const doId = Number(header.source_doc_id) || null;
  const source = doId ? (await sourceOptions(db, { ids: [doId] }, selfId))[0] : undefined;
  if (!doId) errors.source_doc_id = "Pilih Delivery Order.";
  else if (!source) errors.source_doc_id = "Delivery Order tidak ditemukan.";
  else if (source.status !== "Issued") errors.source_doc_id = "Delivery Order harus berstatus Diterbitkan.";
  else if (!source.customerActive) errors.source_doc_id = "Customer pada Delivery Order ini sudah nonaktif.";

  const dnDate = String(header.dn_date ?? "").trim();
  if (!DAY.test(dnDate)) errors.dn_date = "Tanggal kirim wajib diisi.";
  else if (source && dnDate < source.doDate) errors.dn_date = "Tidak boleh sebelum tanggal Delivery Order.";

  const raw = Array.isArray(lines) ? lines : [];
  const out: CheckedLine[] = [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu barang.";
  const byId = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const seen = new Set<number>();
  for (const [i, l] of raw.entries()) {
    const lineId = Number(l.source_doc_line_id) || null;
    const doLine = lineId ? byId.get(lineId) : undefined;
    if (!lineId) {
      errors[lineKey(i, "source_doc_line_id")] = "Pilih barang.";
      continue;
    }
    if (!doLine) {
      if (source) errors[lineKey(i, "source_doc_line_id")] = "Barang bukan bagian Delivery Order ini.";
      continue;
    }
    if (seen.has(lineId)) {
      errors[lineKey(i, "source_doc_line_id")] = `${doLine.itemLabel} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(lineId);
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    const left = fromUnits(units(doLine.qty) - units(doLine.held));
    if (!Number.isFinite(qty) || !(qty > 0)) errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
    else if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
    else if (units(qty) > units(left)) {
      errors[lineKey(i, "qty")] = `Melebihi sisa Delivery Order (${qtyText(left)} ${doLine.uomLabel}).`;
    } else {
      const baseQty = fromUnits(units(qty * doLine.uomFactor));
      const picks = checkPicks(l.picks, doLine, source!.lots[doLine.itemId] ?? [], baseQty, forPosting);
      if (!picks.ok) {
        errors[lineKey(i, "picks")] = picks.error;
        continue;
      }
      // The line carries its own item, unit and factor (P106), copied from the source.
      out.push({
        line_no: out.length + 1,
        source_doc_line_id: lineId,
        item_id: doLine.itemId,
        uom_id: doLine.uomId,
        uom_factor: doLine.uomFactor,
        qty: fromUnits(units(qty)),
        base_qty: baseQty,
        note: text(l.note),
        picks: picks.picks,
      });
    }
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) {
    errors._lines = "Ada baris yang perlu diperbaiki.";
  }

  if (Object.keys(errors).length || !source) return { ok: false, errors };
  return {
    ok: true,
    c: {
      source,
      data: {
        purpose: purpose.key,
        source_doc_type_id: await docTypeId(db, purpose.sourceTable),
        source_doc_id: source.id,
        source_no: source.doNo,
        partner_id: source.customerId,
        warehouse_id: source.warehouseId,
        address_id: source.addressId,
        dn_date: asDate(dnDate),
        vehicle_no: text(header.vehicle_no),
        driver_name: text(header.driver_name),
        note: text(header.note),
      },
      lines: out,
    },
  };
}

/**
 * A line's picking (U15, P268). A lot-tracked line takes buckets of its item in
 * the note's warehouse — lot, location, status — each once, each more than 0,
 * in the base unit, together never more than the line's base quantity — and,
 * to be posted, exactly it. Any other line takes none.
 */
function checkPicks(
  raw: DeliveryNotePickInput[] | undefined,
  line: DnSourceLine,
  lots: LotOption[],
  lineBaseQty: number,
  forPosting: boolean
): { ok: true; picks: CheckedPick[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (!line.lotTracked) {
    // Only an item with Kelola Stok enters the stock books (P120); one without
    // it is not sold, so it may sit in a Draft but never leaves by posting.
    if (list.length) return { ok: false, error: `${line.itemLabel} tidak dikelola per lot.` };
    if (forPosting) return { ok: false, error: `${line.itemLabel} tidak dikelola stok (Kelola Stok tidak aktif), jadi tidak bisa dikeluarkan.` };
    return { ok: true, picks: [] };
  }
  // A pick is a bucket — a lot in a location and a status — so a lot kept in two places is two picks.
  const seen = new Set<string>();
  const picks: CheckedPick[] = [];
  let total = 0;
  const unit = line.baseUomLabel;
  for (const p of list) {
    const lot = lots.find(
      (o) =>
        o.id === Number(p.tracking_id) &&
        o.locationId === (Number(p.location_id) || null) &&
        (p.stock_status_id == null || o.statusId === Number(p.stock_status_id))
    );
    if (!lot) return { ok: false, error: `Lot tidak ada di gudang ini untuk ${line.itemLabel}. Pilih ulang lotnya.` };
    const where = lot.locationLabel ? ` di ${lot.locationLabel}` : "";
    if (seen.has(lot.key)) return { ok: false, error: `Lot ${lot.lotNo}${where} dipilih lebih dari sekali.` };
    seen.add(lot.key);
    const qty = Number(String(p.base_qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || !(qty > 0)) return { ok: false, error: `Isi jumlah lot ${lot.lotNo} lebih dari 0.` };
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) return { ok: false, error: "Jumlah lot paling banyak 4 angka desimal." };
    total += units(qty);
    picks.push({
      pick_no: picks.length + 1,
      tracking_id: lot.id,
      location_id: lot.locationId,
      stock_status_id: lot.statusId,
      tracking_no: lot.lotNo,
      expiry_date: lot.expiry ? asDate(lot.expiry) : null,
      base_qty: fromUnits(units(qty)),
    });
  }
  if (total > units(lineBaseQty)) {
    return { ok: false, error: `Lot yang dipilih (${qtyText(fromUnits(total))} ${unit}) melebihi Qty baris (${qtyText(lineBaseQty)} ${unit}).` };
  }
  if (forPosting && total !== units(lineBaseQty)) {
    return { ok: false, error: `${line.itemLabel}: lot baru ${qtyText(fromUnits(total))} dari ${qtyText(lineBaseQty)} ${unit}. Pilih lot sampai penuh.` };
  }
  return { ok: true, picks };
}

// ------------------------------------------------------------------ writes

async function nextDnNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("SJ", isTaxable), date, async (series) => {
    const row = await db.logDeliveryNote.findFirst({
      where: { dn_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { dn_no: true },
    });
    return row?.dn_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "log_delivery_note", row_id: id, action, event, by } });
}

/** Rules failing inside a transaction roll it back and come out as errors. */
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
    if (e instanceof PeriodShut) return { ok: false, errors: { _form: e.message } };
    if (e instanceof InventoryRefusal) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    // A dry run reached the end of the posting: its journal, with every write rolled back (P103).
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

export async function createDeliveryNote(
  header: DeliveryNoteHeaderInput,
  lines: DeliveryNoteLineInput[],
  actorId: number
): Promise<DeliveryNoteResult> {
  const sourceId = Number(header.source_doc_id) || null;
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      if (sourceId) await lockDeliveryOrderScope(tx, sourceId);
      const r = await checkDeliveryNote(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.logDeliveryNote.create({
        data: {
          ...r.c.data,
          // A sale's note follows its Customer Order's series (P109).
          dn_no: await nextDnNo(tx, r.c.data.dn_date, r.c.source.isTaxable),
          created_by: actorId,
          lines: { create: r.c.lines.map(({ picks, ...l }) => ({ ...l, trackings: { create: picks } })) },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, dnNo: made.dn_no };
  });
}

export async function updateDeliveryNote(
  id: number,
  header: DeliveryNoteHeaderInput,
  lines: DeliveryNoteLineInput[],
  actorId: number
): Promise<DeliveryNoteResult> {
  const current = await prisma.logDeliveryNote.findUnique({
    where: { id },
    select: { status: true, dn_no: true, purpose: true, source_doc_id: true },
  });
  if (!current) return { ok: false, errors: { _form: "Delivery Note tidak ditemukan." } };
  if (!deliveryNoteIsEditable(current.status as DeliveryNoteStatus)) {
    return { ok: false, errors: { _form: "Delivery Note yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  }
  if (Number(header.source_doc_id) !== current.source_doc_id || (header.purpose ?? current.purpose) !== current.purpose) {
    return {
      ok: false,
      errors: { source_doc_id: "Delivery Order tidak dapat diganti. Buat Delivery Note baru untuk Delivery Order lain." },
    };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockDeliveryOrderScope(tx, current.source_doc_id);
      const r = await checkDeliveryNote(tx, { ...header, purpose: current.purpose }, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.logDeliveryNote.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Delivery Note berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines and picks are rewritten whole: nothing names them yet.
      await tx.logDeliveryNoteTracking.deleteMany({ where: { line: { delivery_note_id: id } } });
      await tx.logDeliveryNoteLine.deleteMany({ where: { delivery_note_id: id } });
      for (const { picks, ...l } of r.c.lines) {
        await tx.logDeliveryNoteLine.create({ data: { ...l, delivery_note_id: id, trackings: { create: picks } } });
      }
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, dnNo: current.dn_no };
  });
}

type StoredNote = Prisma.LogDeliveryNoteGetPayload<{ include: { lines: { include: { trackings: true } } } }>;
const WITH_PICKS = { lines: { include: { trackings: { orderBy: { pick_no: "asc" as const } } } } };

function asInput(n: StoredNote): {
  header: DeliveryNoteHeaderInput;
  lines: DeliveryNoteLineInput[];
} {
  return {
    header: {
      purpose: n.purpose,
      source_doc_id: n.source_doc_id,
      dn_date: isoDay(n.dn_date),
      vehicle_no: n.vehicle_no ?? "",
      driver_name: n.driver_name ?? "",
      note: n.note ?? "",
    },
    lines: [...n.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        source_doc_line_id: l.source_doc_line_id,
        qty: l.qty.toNumber(),
        note: l.note ?? "",
        picks: l.trackings.map((p) => ({
          tracking_id: p.tracking_id,
          location_id: p.location_id,
          stock_status_id: p.stock_status_id,
          base_qty: p.base_qty.toNumber(),
        })),
      })),
  };
}

// --------------------------------------------------------------- posting

/**
 * The journal Posting would write now, for the Posting dialog (P103):
 * `transitionDeliveryNote` run as a **dry run** — the Customer Order lock, the
 * recheck, every stock issue through the inventory module and the journal —
 * then rolled back. So the costs shown are what the inventory module returns
 * at posting, and a note that cannot post (short stock, lots not picked in
 * full, Account Mapping incomplete, a closed period) says why in Posting's own
 * words.
 */
export async function deliveryNotePreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionDeliveryNote(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    // Whatever would make Posting fail is the dialog's reason not to offer it.
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

// --------------------------------------------------------------- lifecycle

export type DeliveryNoteTransitionResult =
  | { ok: true; closed?: string[]; /** Only on a dry run: the journal Posting would write. */ journal?: JournalLineInput[] }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step.
 *
 * **Posting**, in one transaction with the Customer Order locked: checks the
 * stored note again (Delivery Order still issued, quantities still within
 * what is left), issues every line through the inventory module and stores the
 * cost it returns, writes the journal Dr HPP / Cr Persediaan dated Tanggal
 * Kirim, and tells the Delivery Order what left — which may close it and its
 * Sales Orders. **Batalkan** (Draft only) asks for a reason and writes nothing
 * else. Every step is conditional on the status just read.
 */
export async function transitionDeliveryNote(
  id: number,
  action: DeliveryNoteAction,
  actorId: number,
  reason?: string,
  /** Run the whole posting, then roll it back and return its journal (P103). */
  options: { dryRun?: boolean } = {}
): Promise<DeliveryNoteTransitionResult> {
  const note = await prisma.logDeliveryNote.findUnique({ where: { id }, include: WITH_PICKS });
  if (!note) return { ok: false, errors: { _form: "Delivery Note tidak ditemukan." } };
  const t = DELIVERY_NOTE_TRANSITIONS[action];
  if (!deliveryNoteTransitionAllowed(action, note.status as DeliveryNoteStatus)) {
    return { ok: false, errors: { _form: `Delivery Note berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Delivery Note berubah saat diproses. Muat ulang halaman.";

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.logDeliveryNote.updateMany({
        where: { id, status: "Draft" },
        data: { status: "Cancelled", cancel_reason: why, updated_by: actorId },
      });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(note.dn_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const posting = PURPOSE_POSTING[note.purpose];
  if (!posting) return { ok: false, errors: { _form: "Tujuan Delivery Note ini belum bisa diposting." } };
  const ready = await posting.prepare([...new Set(note.lines.map((l) => l.item_id))]);
  if (!ready.ok) return { ok: false, errors: { _form: ready.error } };

  return refusable(async () => {
    const closed = await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, isoDay(note.dn_date));
      await posting.lock(tx, note.source_doc_id);
      const input = asInput(note);
      const r = await checkDeliveryNote(tx, input.header, input.lines, id, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const done = await tx.logDeliveryNote.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      // Common to every purpose: each tracking row leaves the stock on its own
      // and stores what its bucket released; the line and the header keep the sums.
      const typeId = await docTypeId(tx, "log_delivery_note");
      const source = { docTypeId: typeId, docId: id, no: note.dn_no };
      const issued: IssuedLine[] = [];
      for (const line of r.c.lines) {
        const where = { delivery_note_id_source_doc_line_id: { delivery_note_id: id, source_doc_line_id: line.source_doc_line_id } };
        const stored = await tx.logDeliveryNoteLine.findUniqueOrThrow({ where, select: { id: true } });
        let cost = 0;
        for (const p of line.picks) {
          const out = await issueStock(tx, {
            itemId: line.item_id,
            warehouseId: r.c.data.warehouse_id,
            locationId: p.location_id,
            lotId: p.tracking_id,
            statusId: p.stock_status_id,
            baseQty: p.base_qty,
            date: r.c.data.dn_date,
            source,
            actorId,
          });
          await tx.logDeliveryNoteTracking.update({
            where: { delivery_note_line_id_pick_no: { delivery_note_line_id: stored.id, pick_no: p.pick_no } },
            data: { cost_amount: out.cost },
          });
          cost += out.cost;
        }
        await tx.logDeliveryNoteLine.update({ where, data: { base_qty: line.base_qty, cost_amount: cost } });
        issued.push({ line, cost });
      }
      const total = issued.reduce((s, l) => s + l.cost, 0);

      // The purpose's own books: its journal and what it writes back to its source.
      const booked = posting.journal({ checked: r.c, issued, dnNo: note.dn_no, accounts: ready.accounts });
      // Stock carried at no value leaves with no journal: nothing moves in the books.
      const journal = !booked.lines.length
        ? null
        : await postJournal(tx, {
            description: booked.description,
            sourceDocTypeId: typeId,
            sourceDocId: id,
            postingDate: r.c.data.dn_date,
            actorId,
            lines: booked.lines,
          });
      await tx.logDeliveryNote.update({ where: { id }, data: { journal_id: journal?.id ?? null, cost_amount: total } });
      await audit(tx, id, "UPDATE", "post", actorId);
      const closed = await posting.writeBack(tx, { checked: r.c, issued, sourceId: note.source_doc_id, actorId });
      if (options.dryRun) throw new PostingDryRun(booked.lines);
      return closed;
    });
    return { ok: true as const, closed };
  });
}

// ------------------------------------------------------- posting per purpose

/** One line as it left: its checked content and what its tracking rows released. */
type IssuedLine = { line: CheckedLine; cost: number };

type ItemAccounts = Map<number, { debit: number; credit: number }>;

/**
 * What one purpose does at Posting (P268). The stock leaving is the same for
 * every purpose; what it is booked against and what it tells its source is
 * not — a sale books HPP and tells its Delivery Order what left, a purchase
 * return will book against the supplier at its receipt's value. So each
 * purpose brings its own posting rather than sharing one forced logic.
 */
type PurposePosting = {
  /** The accounts it needs, read before the transaction; a missing one refuses. */
  prepare(itemIds: number[]): Promise<{ ok: true; accounts: ItemAccounts } | { ok: false; error: string }>;
  /** The lock every document on the source takes. */
  lock(tx: Prisma.TransactionClient, sourceId: number): Promise<void>;
  journal(c: { checked: Checked; issued: IssuedLine[]; dnNo: string; accounts: ItemAccounts }): {
    description: string;
    lines: JournalLineInput[];
  };
  writeBack(tx: Prisma.TransactionClient, c: { checked: Checked; issued: IssuedLine[]; sourceId: number; actorId: number }): Promise<string[] | undefined>;
};

let baseCurrencyId: number | null = null;
async function baseCurrency(): Promise<number | null> {
  baseCurrencyId ??= (await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } }))?.id ?? null;
  return baseCurrencyId;
}

const SALES_DELIVERY_POSTING: PurposePosting = {
  // Each item posts to its Kategori Item's HPP and Persediaan, or to Account
  // Mapping's where the category names none (P122).
  async prepare(itemIds) {
    const fallback = await fallbackAccounts(["cogs_account", "inventory_account"] as const);
    const byCategory = await accountsForItems(itemIds);
    const accounts: ItemAccounts = new Map();
    for (const itemId of byCategory.keys()) {
      const c = byCategory.get(itemId)!;
      const cogs = c.cogs ?? fallback.cogs_account;
      const inventory = c.inventory ?? fallback.inventory_account;
      if (!cogs || !inventory) {
        const missing = [!cogs && "Account HPP", !inventory && "Account Persediaan"].filter(Boolean).join(", ");
        return { ok: false, error: `Lengkapi Account Mapping atau Account Kategori Item dulu: ${missing}.` };
      }
      accounts.set(itemId, { debit: cogs, credit: inventory });
    }
    if (!(await baseCurrency())) return { ok: false, error: "Mata uang dasar tidak ditemukan." };
    return { ok: true, accounts };
  },
  lock: (tx, sourceId) => lockDeliveryOrderScope(tx, sourceId),
  // Dr HPP / Cr Persediaan per line, at what its tracking rows released.
  journal({ checked, issued, dnNo, accounts }) {
    const byId = new Map(checked.source.lines.map((l) => [l.id, l]));
    const currencyId = baseCurrencyId!;
    const lines = issued.flatMap(({ line, cost }) => {
      if (cost <= 0) return [];
      const d = byId.get(line.source_doc_line_id)!;
      const a = accounts.get(line.item_id)!;
      const what = `${d.itemLabel} · ${qtyText(line.qty)} ${d.uomLabel}`;
      return [
        { accountId: a.debit, currencyId, rate: 1, debit: cost, credit: 0, description: `HPP ${what}` },
        { accountId: a.credit, currencyId, rate: 1, debit: 0, credit: cost, description: `Keluar ${checked.source.warehouseLabel} · ${what}` },
      ];
    });
    return { description: `${dnNo} · Pengiriman ${checked.source.doNo} — ${checked.source.customerName}`, lines };
  },
  // What left, told to the Delivery Order — which may close it and its Sales Orders.
  writeBack: (tx, { issued, sourceId, actorId }) =>
    recordDeliveryOrderDelivery(tx, sourceId, new Map(issued.map(({ line }) => [line.source_doc_line_id, line.qty])), actorId),
};

const PURPOSE_POSTING: Record<string, PurposePosting> = { [SALES_DELIVERY]: SALES_DELIVERY_POSTING };

/**
 * Why a Delivery Order may not be closed yet, or null: a Delivery Note on it is
 * still Draft. Handed to the Delivery Order's Tutup by the action that composes
 * the two, so neither module reads the other's tables.
 */
export async function liveDeliveryNoteRefusal(tx: Prisma.TransactionClient, deliveryOrderId: number): Promise<string | null> {
  const live = await tx.logDeliveryNote.findMany({
    where: { purpose: SALES_DELIVERY, source_doc_id: deliveryOrderId, status: "Draft" },
    orderBy: { id: "asc" },
    select: { dn_no: true },
  });
  if (!live.length) return null;
  const names = live.map((n) => n.dn_no);
  return `Masih ada Delivery Note Draft: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` dan ${names.length - 3} lainnya` : ""}. Posting atau batalkan dulu.`;
}

// ------------------------------------------------------------------- reads

export type DeliveryNoteListRow = {
  id: number;
  dnNo: string;
  dnDate: string;
  status: DeliveryNoteStatus;
  purpose: string;
  sourceId: number;
  sourceNo: string;
  customerOrderNo: string;
  customerLabel: string;
  customerName: string;
  warehouseLabel: string;
  lines: number;
  cost: number;
};

export async function listDeliveryNotes(): Promise<DeliveryNoteListRow[]> {
  const rows = await prisma.logDeliveryNote.findMany({
    orderBy: [{ dn_date: "desc" }, { id: "desc" }],
    include: { partner: true, warehouse: true, _count: { select: { lines: true } } },
  });
  // Numbers only: a list shows which orders, not the orders themselves. A note
  // names its Delivery Order; the Customer Order behind it is asked for (P106).
  const coOf = await customerOrderIdsOfDeliveryOrders([
    ...new Set(rows.filter((r) => r.purpose === SALES_DELIVERY).map((r) => r.source_doc_id)),
  ]);
  const orderNos = await customerOrderNumbersByIds([...new Set(coOf.values())]);
  return rows.map((r) => ({
    id: r.id,
    dnNo: r.dn_no,
    dnDate: isoDay(r.dn_date),
    status: r.status as DeliveryNoteStatus,
    purpose: r.purpose,
    sourceId: r.source_doc_id,
    sourceNo: r.source_no,
    customerOrderNo: orderNos.get(coOf.get(r.source_doc_id) ?? 0) ?? "",
    customerLabel: r.partner.partner_label,
    customerName: r.partner.partner_name,
    warehouseLabel: r.warehouse.warehouse_label,
    lines: r._count.lines,
    cost: r.cost_amount.toNumber(),
  }));
}

export type DeliveryNoteView = {
  id: number;
  dnNo: string;
  status: DeliveryNoteStatus;
  header: DeliveryNoteHeaderInput;
  lines: (DeliveryNoteLineInput & {
    /** The stored line's id — what an Invoice names (U17). */
    id: number;
    baseQty: number;
    /** Σ its tracking rows' cost — the summary of what the stock released. */
    cost: number;
    /** The tracking rows, as stored on the note (snapshotted lot no and expiry): the detail and its value. */
    pickedLots: {
      lotId: number;
      locationId: number | null;
      locationLabel: string | null;
      statusId: number;
      statusLabel: string;
      statusName: string;
      lotNo: string;
      expiry: string | null;
      baseQty: number;
      cost: number;
    }[];
  })[];
  cost: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
};

export async function getDeliveryNote(id: number): Promise<DeliveryNoteView | null> {
  const n = await prisma.logDeliveryNote.findUnique({
    where: { id },
    include: {
      lines: { include: { trackings: { orderBy: { pick_no: "asc" }, include: { stock_status: { select: { status_label: true, status_name: true } } } } } },
    },
  });
  if (!n) return null;
  const input = asInput(n);
  const sorted = [...n.lines].sort((a, b) => a.line_no - b.line_no);
  const journalNo = n.journal_id ? ((await journalNumbersByIds([n.journal_id])).get(n.journal_id) ?? null) : null;
  const locations = await locationLabelsByIds(n.lines.flatMap((l) => l.trackings.flatMap((p) => (p.location_id ? [p.location_id] : []))));
  return {
    id: n.id,
    dnNo: n.dn_no,
    status: n.status as DeliveryNoteStatus,
    header: input.header,
    lines: input.lines.map((l, i) => ({
      ...l,
      id: sorted[i].id,
      baseQty: sorted[i].base_qty.toNumber(),
      cost: sorted[i].cost_amount.toNumber(),
      pickedLots: sorted[i].trackings.map((p) => ({
        lotId: p.tracking_id,
        locationId: p.location_id,
        locationLabel: p.location_id ? (locations.get(p.location_id) ?? null) : null,
        statusId: p.stock_status_id,
        statusLabel: p.stock_status.status_label,
        statusName: p.stock_status.status_name,
        lotNo: p.tracking_no,
        expiry: p.expiry_date ? isoDay(p.expiry_date) : null,
        baseQty: p.base_qty.toNumber(),
        cost: p.cost_amount.toNumber(),
      })),
    })),
    cost: n.cost_amount.toNumber(),
    journalId: n.journal_id,
    journalNo,
    cancelReason: n.cancel_reason,
  };
}

/** Delivery Note numbers by id, for the audit panel. */
/**
 * For the Lokasi Gudang master (P267): how many Draft Delivery Notes take
 * goods out of the warehouse, and which of the locations named a pick of any
 * note takes goods from.
 */
export async function deliveryNoteLocationUse(warehouseId: number, locationIds: number[]): Promise<{ drafts: number; named: Set<number> }> {
  const [drafts, named] = await Promise.all([
    prisma.logDeliveryNote.count({ where: { warehouse_id: warehouseId, status: "Draft" } }),
    locationIds.length
      ? prisma.logDeliveryNoteTracking.findMany({ where: { location_id: { in: locationIds } }, distinct: ["location_id"], select: { location_id: true } })
      : [],
  ]);
  return { drafts, named: new Set(named.flatMap((r) => (r.location_id ? [r.location_id] : []))) };
}

export async function deliveryNoteNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logDeliveryNote.findMany({ where: { id: { in: ids } }, select: { id: true, dn_no: true } });
  return new Map(rows.map((r) => [r.id, r.dn_no]));
}

/**
 * A Delivery Order's shipping, for its own page: the notes made from it, and
 * per line what they hold (sent or reserved by a Draft) and what has left. The
 * Delivery Order's page composes this with its own record.
 */
export type DeliveryOrderNotes = {
  notes: { id: number; dnNo: string; dnDate: string; status: DeliveryNoteStatus }[];
  lines: DnSourceLine[];
};

export async function deliveryOrderNotes(deliveryOrderId: number): Promise<DeliveryOrderNotes> {
  const [rows, [source]] = await Promise.all([
    prisma.logDeliveryNote.findMany({
      where: { purpose: SALES_DELIVERY, source_doc_id: deliveryOrderId },
      orderBy: [{ dn_date: "asc" }, { id: "asc" }],
    }),
    sourceOptions(prisma, { ids: [deliveryOrderId] }, null),
  ]);
  return {
    notes: rows.map((r) => ({ id: r.id, dnNo: r.dn_no, dnDate: isoDay(r.dn_date), status: r.status as DeliveryNoteStatus })),
    lines: source?.lines ?? [],
  };
}

// ------------------------------------------------------------- for the Invoice

/**
 * A Delivery Note line as an Invoice Penjualan reads it (U17): a quantity that
 * left, of one Customer Order line, on a posted note with its Tanggal Kirim.
 * The Invoice takes the line whole; it names it by id and prices it from the
 * Customer Order line. A posted note never changes, so what an Invoice bills
 * does not move.
 */
export type InvoiceSourceLine = {
  id: number;
  deliveryNoteId: number;
  dnNo: string;
  dnDate: string;
  status: DeliveryNoteStatus;
  customerOrderId: number;
  customerOrderLineId: number;
  salesOrderNo: string;
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  qty: number;
  /** The lots it left from, as printed on the note. */
  lots: string[];
};

/**
 * Lines of posted notes — of the orders named, or every order — or the lines
 * named, whatever their note's status, for a stored Invoice.
 */
/**
 * Every posted note line, as ids only, with its Customer Order — cheap enough
 * to read whole, so the Invoice form can find the orders that still have
 * something to bill before it loads any order in full.
 */
export async function postedNoteLineIds(db: Db = prisma): Promise<{ id: number; customerOrderId: number }[]> {
  const rows = await db.logDeliveryNoteLine.findMany({
    where: { delivery_note: { purpose: SALES_DELIVERY, status: "Posted" } },
    select: { id: true, delivery_note: { select: { source_doc_id: true } } },
  });
  const coOf = await customerOrderIdsOfDeliveryOrders([...new Set(rows.map((r) => r.delivery_note.source_doc_id))], db);
  return rows.map((r) => ({ id: r.id, customerOrderId: coOf.get(r.delivery_note.source_doc_id) ?? 0 }));
}

export async function invoiceSourceLines(
  filter: { customerOrderIds?: number[]; lineIds?: number[] },
  db: Db = prisma
): Promise<InvoiceSourceLine[]> {
  // A sale's notes name their Delivery Order; the orders' Delivery Orders are asked for (P106).
  const doIds = filter.customerOrderIds ? await deliveryOrderIdsOfCustomerOrders(filter.customerOrderIds, db) : null;
  const notes = await db.logDeliveryNote.findMany({
    where: filter.lineIds
      ? { purpose: SALES_DELIVERY, lines: { some: { id: { in: filter.lineIds } } } }
      : { purpose: SALES_DELIVERY, status: "Posted", ...(doIds ? { source_doc_id: { in: doIds } } : {}) },
    orderBy: [{ dn_date: "asc" }, { id: "asc" }],
    include: { lines: { include: { trackings: { orderBy: { pick_no: "asc" } } }, orderBy: { line_no: "asc" } } },
  });
  if (!notes.length) return [];
  const sources = await deliveryNoteSources({ ids: [...new Set(notes.map((n) => n.source_doc_id))] }, db);
  const coOf = new Map(sources.map((s) => [s.id, s.customerOrderId]));
  const doLine = new Map(sources.flatMap((s) => s.lines.map((l) => [l.id, l] as const)));
  return notes.flatMap((n) =>
    n.lines
      .filter((l) => !filter.lineIds || filter.lineIds.includes(l.id))
      .map((l) => {
        const d = doLine.get(l.source_doc_line_id);
        return {
          id: l.id,
          deliveryNoteId: n.id,
          dnNo: n.dn_no,
          dnDate: isoDay(n.dn_date),
          status: n.status as DeliveryNoteStatus,
          customerOrderId: coOf.get(n.source_doc_id) ?? 0,
          customerOrderLineId: d?.customerOrderLineId ?? 0,
          salesOrderNo: d?.salesOrderNo ?? "",
          itemLabel: d?.itemLabel ?? "",
          itemName: d?.itemName ?? "",
          uomLabel: d?.uomLabel ?? "",
          qty: l.qty.toNumber(),
          lots: l.trackings.map((p) => p.tracking_no),
        };
      })
  );
}

/** Drafts dated up to a day — the month-end close's checklist (R28). */
export async function draftDeliveryNotesUpTo(to: Date, db: Db = prisma): Promise<number> {
  return db.logDeliveryNote.count({ where: { status: "Draft", dn_date: { lte: to } } });
}

export type LotDelivery = { lotId: number; noteId: number; noteNo: string; date: string; partnerLabel: string; partnerName: string; baseQty: number };

/** Posted Delivery Notes that took these lots — where goods went to the customer (Telusur Produksi, R27). */
export async function deliveriesOfLots(lotIds: number[]): Promise<LotDelivery[]> {
  if (!lotIds.length) return [];
  const rows = await prisma.logDeliveryNoteTracking.findMany({
    where: { tracking_id: { in: lotIds }, line: { delivery_note: { status: "Posted" } } },
    include: { line: { include: { delivery_note: { include: { partner: { select: { partner_label: true, partner_name: true } } } } } } },
  });
  return rows.map((r) => ({
    lotId: r.tracking_id,
    noteId: r.line.delivery_note.id,
    noteNo: r.line.delivery_note.dn_no,
    date: r.line.delivery_note.dn_date.toISOString().slice(0, 10),
    partnerLabel: r.line.delivery_note.partner.partner_label,
    partnerName: r.line.delivery_note.partner.partner_name,
    baseQty: r.base_qty.toNumber(),
  }));
}
