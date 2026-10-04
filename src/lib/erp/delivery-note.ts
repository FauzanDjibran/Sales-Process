import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { formatNumber } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate } from "./fiscal";
import { journalNumbersByIds, postJournal } from "./journal";
import { lockCustomerOrder } from "./customer-order";
import {
  deliveryNoteSources,
  recordDeliveryOrderDelivery,
  type DeliveryNoteSource,
  type DeliveryNoteSourceLine,
} from "./delivery-order";
import { InventoryRefusal, issueStock, issueValuation, lotOptions, lotTrackedItems, type LotOption } from "./inventory";
import { postingAccounts } from "./system-settings";
import {
  DELIVERY_NOTE_HOLDS_QTY,
  DELIVERY_NOTE_TRANSITIONS,
  deliveryNoteIsEditable,
  deliveryNoteTransitionAllowed,
  type DeliveryNoteAction,
  type DeliveryNoteStatus,
} from "./delivery-note-workflow";

/**
 * The Delivery Note module (C28, U11–U15): its tables are `sal_delivery_note`,
 * `sal_delivery_note_line` and `sal_delivery_note_pick`, and nothing else names
 * them.
 *
 * A Delivery Note is the document the goods leave on. It is made from one
 * issued Delivery Order — whose Customer Order, customer, warehouse and address
 * it copies — and takes a quantity of some of its lines; a Delivery Order may
 * be sent in several notes, never more than its lines in total. A Barang with
 * Kelola Stok is picked by lot on the note (U15). Posting issues the goods —
 * lot by lot where picked — through the inventory module, which says what they
 * cost, and
 * writes one journal: Dr HPP / Cr Persediaan. **Cost of goods only** — Piutang
 * is born at the Faktur, which will take this note's lines whole.
 *
 * The Delivery Order is read through `deliveryNoteSources` and told what left
 * through `recordDeliveryOrderDelivery`; the Customer Order is locked through
 * `lockCustomerOrder`, the same lock every document on the order takes.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type DeliveryNoteHeaderInput = {
  delivery_order_id: number | null;
  dn_date: string;
  vehicle_no: string;
  driver_name: string;
  note: string;
};

/** One lot a line takes goods from — the stock picking (U15). */
export type DeliveryNotePickInput = { lot_id: number | null; qty: number | string };

export type DeliveryNoteLineInput = {
  delivery_order_line_id: number | null;
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

/** What other notes — Draft or Posted, but not `exceptId` — hold of each Delivery Order line. */
async function heldByLines(db: Db, lineIds: number[], exceptId: number | null): Promise<Map<number, number>> {
  if (!lineIds.length) return new Map();
  const rows = await db.salDeliveryNoteLine.groupBy({
    by: ["delivery_order_line_id"],
    where: {
      delivery_order_line_id: { in: lineIds },
      delivery_note: { status: { in: DELIVERY_NOTE_HOLDS_QTY }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.delivery_order_line_id, r._sum?.qty?.toNumber() ?? 0]));
}

// ---------------------------------------------------------------- options

export type DnSourceLine = DeliveryNoteSourceLine & {
  /** What other Delivery Notes hold of this line — sent or reserved by a Draft. */
  held: number;
  /** The item leaves by lot (Kelola Stok, U15): the line must be picked. */
  lotTracked: boolean;
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
  const held = await heldByLines(db, sources.flatMap((s) => s.lines.map((l) => l.id)), exceptId);
  const tracked = await lotTrackedItems([...new Set(sources.flatMap((s) => s.lines.map((l) => l.itemId)))], db);
  const out: DnSourceOption[] = [];
  for (const s of sources) {
    const lotItems = [...new Set(s.lines.map((l) => l.itemId).filter((id) => tracked.has(id)))];
    const lots = await lotOptions(lotItems, s.warehouseId, db, withLotIds);
    out.push({
      ...s,
      lines: s.lines.map((l) => ({ ...l, held: held.get(l.id) ?? 0, lotTracked: tracked.has(l.itemId) })),
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
  current: { id: number; deliveryOrderId: number; lotIds?: number[] } | null = null
): Promise<DeliveryNoteOptions> {
  const issued = (await sourceOptions(prisma, { issuedOnly: true }, current?.id ?? null)).filter(
    (o) => o.id !== current?.deliveryOrderId && o.lines.some((l) => units(l.qty) > units(l.held))
  );
  if (current) issued.push(...(await sourceOptions(prisma, { ids: [current.deliveryOrderId] }, current.id, current.lotIds ?? [])));
  return { orders: issued };
}

// ------------------------------------------------------------- validation

type CheckedPick = { pick_no: number; lot_id: number; lot_no: string; expiry_date: Date | null; qty: number };

type CheckedLine = {
  line_no: number;
  delivery_order_line_id: number;
  qty: number;
  note: string | null;
  picks: CheckedPick[];
};

type Checked = {
  source: DnSourceOption;
  data: {
    delivery_order_id: number;
    customer_order_id: number;
    customer_id: number;
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

  const doId = Number(header.delivery_order_id) || null;
  const source = doId ? (await sourceOptions(db, { ids: [doId] }, selfId))[0] : undefined;
  if (!doId) errors.delivery_order_id = "Pilih Delivery Order.";
  else if (!source) errors.delivery_order_id = "Delivery Order tidak ditemukan.";
  else if (source.status !== "Issued") errors.delivery_order_id = "Delivery Order harus berstatus Diterbitkan.";
  else if (!source.customerActive) errors.delivery_order_id = "Customer pada Delivery Order ini sudah nonaktif.";

  const dnDate = String(header.dn_date ?? "").trim();
  if (!DAY.test(dnDate)) errors.dn_date = "Tanggal kirim wajib diisi.";
  else if (source && dnDate < source.doDate) errors.dn_date = "Tidak boleh sebelum tanggal Delivery Order.";

  const raw = Array.isArray(lines) ? lines : [];
  const out: CheckedLine[] = [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu barang.";
  const byId = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const seen = new Set<number>();
  for (const [i, l] of raw.entries()) {
    const lineId = Number(l.delivery_order_line_id) || null;
    const doLine = lineId ? byId.get(lineId) : undefined;
    if (!lineId) {
      errors[lineKey(i, "delivery_order_line_id")] = "Pilih barang.";
      continue;
    }
    if (!doLine) {
      if (source) errors[lineKey(i, "delivery_order_line_id")] = "Barang bukan bagian Delivery Order ini.";
      continue;
    }
    if (seen.has(lineId)) {
      errors[lineKey(i, "delivery_order_line_id")] = `${doLine.itemLabel} dipilih lebih dari sekali.`;
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
      const picks = checkPicks(l.picks, doLine, source!.lots[doLine.itemId] ?? [], fromUnits(units(qty)), forPosting);
      if (!picks.ok) {
        errors[lineKey(i, "picks")] = picks.error;
        continue;
      }
      out.push({
        line_no: out.length + 1,
        delivery_order_line_id: lineId,
        qty: fromUnits(units(qty)),
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
        delivery_order_id: source.id,
        customer_order_id: source.customerOrderId,
        customer_id: source.customerId,
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
 * A line's picking (U15). A lot-tracked line takes lots of its item in the
 * note's warehouse, each once, each more than 0, together never more than the
 * line — and, to be posted, exactly the line. Any other line takes none.
 */
function checkPicks(
  raw: DeliveryNotePickInput[] | undefined,
  line: DnSourceLine,
  lots: LotOption[],
  lineQty: number,
  forPosting: boolean
): { ok: true; picks: CheckedPick[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (!line.lotTracked) {
    return list.length ? { ok: false, error: `${line.itemLabel} tidak dikelola per lot.` } : { ok: true, picks: [] };
  }
  const byId = new Map(lots.map((l) => [l.id, l]));
  const seen = new Set<number>();
  const picks: CheckedPick[] = [];
  let total = 0;
  for (const p of list) {
    const lot = byId.get(Number(p.lot_id));
    if (!lot) return { ok: false, error: `Lot tidak ada di gudang ini untuk ${line.itemLabel}.` };
    if (seen.has(lot.id)) return { ok: false, error: `Lot ${lot.lotNo} dipilih lebih dari sekali.` };
    seen.add(lot.id);
    const qty = Number(String(p.qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || !(qty > 0)) return { ok: false, error: `Isi jumlah lot ${lot.lotNo} lebih dari 0.` };
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) return { ok: false, error: "Jumlah lot paling banyak 4 angka desimal." };
    total += units(qty);
    picks.push({
      pick_no: picks.length + 1,
      lot_id: lot.id,
      lot_no: lot.lotNo,
      expiry_date: lot.expiry ? asDate(lot.expiry) : null,
      qty: fromUnits(units(qty)),
    });
  }
  if (total > units(lineQty)) {
    return { ok: false, error: `Lot yang dipilih (${qtyText(fromUnits(total))}) melebihi Qty baris (${qtyText(lineQty)} ${line.uomLabel}).` };
  }
  if (forPosting && total !== units(lineQty)) {
    return { ok: false, error: `${line.itemLabel}: lot baru ${qtyText(fromUnits(total))} dari ${qtyText(lineQty)} ${line.uomLabel}. Pilih lot sampai penuh.` };
  }
  return { ok: true, picks };
}

// ------------------------------------------------------------------ writes

async function nextDnNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("SJ", date, async (series) => {
    const row = await db.salDeliveryNote.findFirst({
      where: { dn_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { dn_no: true },
    });
    return row?.dn_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "sal_delivery_note", row_id: id, action, event, by } });
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
    if (e instanceof InventoryRefusal) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    throw e;
  }
}

/** The Customer Order a Delivery Order belongs to, so its lock can be taken first. */
async function customerOrderOf(deliveryOrderId: number | null): Promise<number | null> {
  if (!deliveryOrderId) return null;
  const [source] = await deliveryNoteSources({ ids: [deliveryOrderId] });
  return source?.customerOrderId ?? null;
}

export async function createDeliveryNote(
  header: DeliveryNoteHeaderInput,
  lines: DeliveryNoteLineInput[],
  actorId: number
): Promise<DeliveryNoteResult> {
  const coId = await customerOrderOf(Number(header.delivery_order_id) || null);
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      if (coId) await lockCustomerOrder(tx, coId);
      const r = await checkDeliveryNote(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.salDeliveryNote.create({
        data: {
          ...r.c.data,
          dn_no: await nextDnNo(tx, r.c.data.dn_date),
          created_by: actorId,
          lines: { create: r.c.lines.map(({ picks, ...l }) => ({ ...l, picks: { create: picks } })) },
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
  const current = await prisma.salDeliveryNote.findUnique({
    where: { id },
    select: { status: true, dn_no: true, delivery_order_id: true, customer_order_id: true },
  });
  if (!current) return { ok: false, errors: { _form: "Delivery Note tidak ditemukan." } };
  if (!deliveryNoteIsEditable(current.status as DeliveryNoteStatus)) {
    return { ok: false, errors: { _form: "Delivery Note yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  }
  if (Number(header.delivery_order_id) !== current.delivery_order_id) {
    return {
      ok: false,
      errors: { delivery_order_id: "Delivery Order tidak dapat diganti. Buat Delivery Note baru untuk Delivery Order lain." },
    };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, current.customer_order_id);
      const r = await checkDeliveryNote(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.salDeliveryNote.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Delivery Note berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines and picks are rewritten whole: nothing names them yet.
      await tx.salDeliveryNotePick.deleteMany({ where: { line: { delivery_note_id: id } } });
      await tx.salDeliveryNoteLine.deleteMany({ where: { delivery_note_id: id } });
      for (const { picks, ...l } of r.c.lines) {
        await tx.salDeliveryNoteLine.create({ data: { ...l, delivery_note_id: id, picks: { create: picks } } });
      }
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, dnNo: current.dn_no };
  });
}

type StoredNote = Prisma.SalDeliveryNoteGetPayload<{ include: { lines: { include: { picks: true } } } }>;
const WITH_PICKS = { lines: { include: { picks: { orderBy: { pick_no: "asc" as const } } } } };

function asInput(n: StoredNote): {
  header: DeliveryNoteHeaderInput;
  lines: DeliveryNoteLineInput[];
} {
  return {
    header: {
      delivery_order_id: n.delivery_order_id,
      dn_date: isoDay(n.dn_date),
      vehicle_no: n.vehicle_no ?? "",
      driver_name: n.driver_name ?? "",
      note: n.note ?? "",
    },
    lines: [...n.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        delivery_order_line_id: l.delivery_order_line_id,
        qty: l.qty.toNumber(),
        note: l.note ?? "",
        picks: l.picks.map((p) => ({ lot_id: p.lot_id, qty: p.qty.toNumber() })),
      })),
  };
}

// --------------------------------------------------------------- posting

export type DeliveryNotePreviewLine = {
  itemLabel: string;
  itemName: string;
  qty: number;
  uomLabel: string;
  baseQty: number;
  unitCost: number | null;
  cost: number;
  /** The lots the line leaves from, for a lot-tracked item. */
  picks: { lotNo: string; qty: number }[];
};

/**
 * What Posting would write, read before it runs so the confirmation can show
 * the journal (design convention: consequences before commitment). Posting
 * computes it again inside its transaction.
 */
type PreviewAccount = { code: string; name: string };

export type DeliveryNotePreview = {
  lines: DeliveryNotePreviewLine[];
  total: number;
  /** Items the inventory cannot issue yet — no Harga Pokok. */
  missingCost: string[];
  /** Lot-tracked lines not yet picked in full (U15), as "ITEM: 4 dari 10 PCS". */
  unpicked: string[];
  accounts: { cogs: PreviewAccount | null; inventory: PreviewAccount | null; missing: string[] };
};

export async function deliveryNotePreview(id: number): Promise<DeliveryNotePreview | null> {
  const n = await prisma.salDeliveryNote.findUnique({ where: { id }, include: WITH_PICKS });
  if (!n) return null;
  const [source] = await deliveryNoteSources({ ids: [n.delivery_order_id] });
  const tracked = await lotTrackedItems((source?.lines ?? []).map((l) => l.itemId));
  const unpicked: string[] = [];
  const byId = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const docLines = [...n.lines].sort((a, b) => a.line_no - b.line_no);
  const valuation = await issueValuation([...new Set(docLines.map((l) => byId.get(l.delivery_order_line_id)?.itemId ?? 0))]);
  const lines = docLines.map((l) => {
    const d = byId.get(l.delivery_order_line_id);
    const qty = l.qty.toNumber();
    const baseQty = fromUnits(units(qty * (d?.uomFactor ?? 1)));
    const unitCost = valuation.get(d?.itemId ?? 0) ?? null;
    const lotTracked = tracked.has(d?.itemId ?? 0);
    const picks = l.picks.map((p) => ({ lotNo: p.lot_no, qty: p.qty.toNumber() }));
    const picked = picks.reduce((s, p) => s + units(p.qty), 0);
    if (lotTracked && picked !== units(qty)) {
      unpicked.push(`${d?.itemLabel ?? ""}: ${qtyText(fromUnits(picked))} dari ${qtyText(qty)} ${d?.uomLabel ?? ""}`);
    }
    // Posting issues each pick on its own, rounding each to whole rupiah.
    const parts = lotTracked && picks.length ? picks.map((p) => fromUnits(units(p.qty * (d?.uomFactor ?? 1)))) : [baseQty];
    return {
      itemLabel: d?.itemLabel ?? "",
      itemName: d?.itemName ?? "",
      qty,
      uomLabel: d?.uomLabel ?? "",
      baseQty,
      unitCost,
      cost: unitCost === null ? 0 : parts.reduce((s, b) => s + Math.round(b * unitCost), 0),
      picks: lotTracked ? picks : [],
    };
  });
  const mapped = await postingAccounts(["cogs_account", "inventory_account"] as const);
  let accounts: DeliveryNotePreview["accounts"] = { cogs: null, inventory: null, missing: [] };
  if (mapped.ok) {
    const accs = await prisma.accAccount.findMany({
      where: { id: { in: [mapped.ids.cogs_account, mapped.ids.inventory_account] } },
      select: { id: true, account_code: true, account_name: true },
    });
    const name = (accId: number) => {
      const a = accs.find((x) => x.id === accId);
      return a ? { code: a.account_code, name: a.account_name } : null;
    };
    accounts = { cogs: name(mapped.ids.cogs_account), inventory: name(mapped.ids.inventory_account), missing: [] };
  } else accounts.missing = mapped.missing;
  return {
    lines,
    total: lines.reduce((s, l) => s + l.cost, 0),
    missingCost: lines.filter((l) => l.unitCost === null).map((l) => l.itemLabel),
    unpicked,
    accounts,
  };
}

// --------------------------------------------------------------- lifecycle

export type DeliveryNoteTransitionResult = { ok: true; closed?: string[] } | { ok: false; errors: Record<string, string> };

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
  reason?: string
): Promise<DeliveryNoteTransitionResult> {
  const note = await prisma.salDeliveryNote.findUnique({ where: { id }, include: WITH_PICKS });
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
      const done = await tx.salDeliveryNote.updateMany({
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
  const accounts = await postingAccounts(["cogs_account", "inventory_account"] as const);
  if (!accounts.ok) {
    return { ok: false, errors: { _form: `Lengkapi Account Mapping dulu: ${accounts.missing.join(", ")}.` } };
  }
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    const closed = await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, note.customer_order_id);
      const input = asInput(note);
      const r = await checkDeliveryNote(tx, input.header, input.lines, id, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const done = await tx.salDeliveryNote.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const typeId = await docTypeId(tx, "sal_delivery_note");
      const byId = new Map(r.c.source.lines.map((l) => [l.id, l]));
      const journalLines: Parameters<typeof postJournal>[1]["lines"] = [];
      const sent = new Map<number, number>();
      let total = 0;
      for (const line of r.c.lines) {
        const d = byId.get(line.delivery_order_line_id)!;
        const baseQty = fromUnits(units(line.qty * d.uomFactor));
        const where = { delivery_note_id_delivery_order_line_id: { delivery_note_id: id, delivery_order_line_id: line.delivery_order_line_id } };
        const source = { docTypeId: typeId, docId: id, no: note.dn_no };
        // A picked line leaves lot by lot, one stock movement per pick (U15);
        // the line's cost is what its picks cost.
        const issued = { unitCost: 0, cost: 0 };
        if (line.picks.length) {
          const stored = await tx.salDeliveryNoteLine.findUniqueOrThrow({ where, select: { id: true } });
          for (const p of line.picks) {
            const pickBase = fromUnits(units(p.qty * d.uomFactor));
            const out = await issueStock(tx, {
              itemId: d.itemId,
              warehouseId: r.c.source.warehouseId,
              lotId: p.lot_id,
              baseQty: pickBase,
              date: r.c.data.dn_date,
              source,
              actorId,
            });
            await tx.salDeliveryNotePick.update({
              where: { delivery_note_line_id_pick_no: { delivery_note_line_id: stored.id, pick_no: p.pick_no } },
              data: { base_qty: pickBase, unit_cost: out.unitCost, cost_amount: out.cost },
            });
            issued.unitCost = out.unitCost;
            issued.cost += out.cost;
          }
        } else {
          Object.assign(
            issued,
            await issueStock(tx, { itemId: d.itemId, warehouseId: r.c.source.warehouseId, baseQty, date: r.c.data.dn_date, source, actorId })
          );
        }
        await tx.salDeliveryNoteLine.update({ where, data: { base_qty: baseQty, unit_cost: issued.unitCost, cost_amount: issued.cost } });
        sent.set(line.delivery_order_line_id, line.qty);
        total += issued.cost;
        if (issued.cost > 0) {
          const what = `${d.itemLabel} · ${qtyText(line.qty)} ${d.uomLabel}`;
          journalLines.push(
            { accountId: accounts.ids.cogs_account, currencyId: baseCurrency.id, rate: 1, debit: issued.cost, credit: 0, description: `HPP ${what}` },
            {
              accountId: accounts.ids.inventory_account,
              currencyId: baseCurrency.id,
              rate: 1,
              debit: 0,
              credit: issued.cost,
              description: `Keluar ${r.c.source.warehouseLabel} · ${what}`,
            }
          );
        }
      }
      if (!journalLines.length) throw new Refused({ _form: "Belum bisa diposting: harga pokok seluruh barang bernilai 0." });
      const journal = await postJournal(tx, {
        description: `${note.dn_no} · Pengiriman ${r.c.source.doNo} — ${r.c.source.customerName}`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: r.c.data.dn_date,
        actorId,
        lines: journalLines,
      });
      await tx.salDeliveryNote.update({ where: { id }, data: { journal_id: journal.id, cost_amount: total } });
      await audit(tx, id, "UPDATE", "post", actorId);
      return recordDeliveryOrderDelivery(tx, note.delivery_order_id, sent, actorId);
    });
    return { ok: true as const, closed };
  });
}

/**
 * Why a Delivery Order may not be closed yet, or null: a Delivery Note on it is
 * still Draft. Handed to the Delivery Order's Tutup by the action that composes
 * the two, so neither module reads the other's tables.
 */
export async function liveDeliveryNoteRefusal(tx: Prisma.TransactionClient, deliveryOrderId: number): Promise<string | null> {
  const live = await tx.salDeliveryNote.findMany({
    where: { delivery_order_id: deliveryOrderId, status: "Draft" },
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
  deliveryOrderId: number;
  deliveryOrderNo: string;
  customerOrderNo: string;
  customerLabel: string;
  customerName: string;
  warehouseLabel: string;
  lines: number;
  cost: number;
};

export async function listDeliveryNotes(): Promise<DeliveryNoteListRow[]> {
  const rows = await prisma.salDeliveryNote.findMany({
    orderBy: [{ dn_date: "desc" }, { id: "desc" }],
    include: { customer: true, warehouse: true, _count: { select: { lines: true } } },
  });
  const sources = new Map(
    (await deliveryNoteSources({ ids: [...new Set(rows.map((r) => r.delivery_order_id))] })).map((s) => [s.id, s])
  );
  return rows.map((r) => ({
    id: r.id,
    dnNo: r.dn_no,
    dnDate: isoDay(r.dn_date),
    status: r.status as DeliveryNoteStatus,
    deliveryOrderId: r.delivery_order_id,
    deliveryOrderNo: sources.get(r.delivery_order_id)?.doNo ?? "",
    customerOrderNo: sources.get(r.delivery_order_id)?.customerOrderNo ?? "",
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
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
    /** The stored line's id — what a Faktur names (U17). */
    id: number;
    baseQty: number;
    unitCost: number;
    cost: number;
    /** The lots picked, as stored on the note (snapshotted lot no and expiry). */
    pickedLots: { lotId: number; lotNo: string; expiry: string | null; qty: number; cost: number }[];
  })[];
  cost: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
};

export async function getDeliveryNote(id: number): Promise<DeliveryNoteView | null> {
  const n = await prisma.salDeliveryNote.findUnique({ where: { id }, include: WITH_PICKS });
  if (!n) return null;
  const input = asInput(n);
  const sorted = [...n.lines].sort((a, b) => a.line_no - b.line_no);
  const journalNo = n.journal_id ? ((await journalNumbersByIds([n.journal_id])).get(n.journal_id) ?? null) : null;
  return {
    id: n.id,
    dnNo: n.dn_no,
    status: n.status as DeliveryNoteStatus,
    header: input.header,
    lines: input.lines.map((l, i) => ({
      ...l,
      id: sorted[i].id,
      baseQty: sorted[i].base_qty.toNumber(),
      unitCost: sorted[i].unit_cost.toNumber(),
      cost: sorted[i].cost_amount.toNumber(),
      pickedLots: sorted[i].picks.map((p) => ({
        lotId: p.lot_id,
        lotNo: p.lot_no,
        expiry: p.expiry_date ? isoDay(p.expiry_date) : null,
        qty: p.qty.toNumber(),
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
export async function deliveryNoteNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salDeliveryNote.findMany({ where: { id: { in: ids } }, select: { id: true, dn_no: true } });
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
    prisma.salDeliveryNote.findMany({ where: { delivery_order_id: deliveryOrderId }, orderBy: [{ dn_date: "asc" }, { id: "asc" }] }),
    sourceOptions(prisma, { ids: [deliveryOrderId] }, null),
  ]);
  return {
    notes: rows.map((r) => ({ id: r.id, dnNo: r.dn_no, dnDate: isoDay(r.dn_date), status: r.status as DeliveryNoteStatus })),
    lines: source?.lines ?? [],
  };
}

// ------------------------------------------------------------- for the Faktur

/**
 * A Delivery Note line as a Faktur Penjualan reads it (U17): a quantity that
 * left, of one Customer Order line, on a posted note with its Tanggal Kirim.
 * The Faktur takes the line whole; it names it by id and prices it from the
 * Customer Order line. A posted note never changes, so what a Faktur bills
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
 * named, whatever their note's status, for a stored Faktur.
 */
export async function invoiceSourceLines(
  filter: { customerOrderIds?: number[]; lineIds?: number[] },
  db: Db = prisma
): Promise<InvoiceSourceLine[]> {
  const notes = await db.salDeliveryNote.findMany({
    where: filter.lineIds
      ? { lines: { some: { id: { in: filter.lineIds } } } }
      : { status: "Posted", ...(filter.customerOrderIds ? { customer_order_id: { in: filter.customerOrderIds } } : {}) },
    orderBy: [{ dn_date: "asc" }, { id: "asc" }],
    include: { lines: { include: { picks: { orderBy: { pick_no: "asc" } } }, orderBy: { line_no: "asc" } } },
  });
  if (!notes.length) return [];
  const sources = await deliveryNoteSources({ ids: [...new Set(notes.map((n) => n.delivery_order_id))] }, db);
  const doLine = new Map(sources.flatMap((s) => s.lines.map((l) => [l.id, l] as const)));
  return notes.flatMap((n) =>
    n.lines
      .filter((l) => !filter.lineIds || filter.lineIds.includes(l.id))
      .map((l) => {
        const d = doLine.get(l.delivery_order_line_id);
        return {
          id: l.id,
          deliveryNoteId: n.id,
          dnNo: n.dn_no,
          dnDate: isoDay(n.dn_date),
          status: n.status as DeliveryNoteStatus,
          customerOrderId: n.customer_order_id,
          customerOrderLineId: d?.customerOrderLineId ?? 0,
          salesOrderNo: d?.salesOrderNo ?? "",
          itemLabel: d?.itemLabel ?? "",
          itemName: d?.itemName ?? "",
          uomLabel: d?.uomLabel ?? "",
          qty: l.qty.toNumber(),
          lots: l.picks.map((p) => p.lot_no),
        };
      })
  );
}
