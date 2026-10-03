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
import { InventoryRefusal, issueStock, issueValuation } from "./inventory";
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
 * The Delivery Note module (C28, U11–U14): its tables are `sal_delivery_note`
 * and `sal_delivery_note_line`, and nothing else names them.
 *
 * A Delivery Note is the document the goods leave on. It is made from one
 * issued Delivery Order — whose Customer Order, customer, warehouse and address
 * it copies — and takes a quantity of some of its lines; a Delivery Order may
 * be sent in several notes, never more than its lines in total. Posting issues
 * the goods through the inventory module, which says what they cost, and
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

export type DeliveryNoteLineInput = {
  delivery_order_line_id: number | null;
  qty: number | string;
  note: string;
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
};

export type DnSourceOption = Omit<DeliveryNoteSource, "lines"> & { lines: DnSourceLine[] };

export type DeliveryNoteOptions = { orders: DnSourceOption[] };

async function sourceOptions(
  db: Db,
  filter: { ids?: number[]; issuedOnly?: boolean },
  exceptId: number | null
): Promise<DnSourceOption[]> {
  const sources = await deliveryNoteSources(filter, db);
  const held = await heldByLines(db, sources.flatMap((s) => s.lines.map((l) => l.id)), exceptId);
  return sources.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, held: held.get(l.id) ?? 0 })) }));
}

/**
 * What the form offers: every issued Delivery Order with something left to
 * send. `current` is the note being edited or shown — its own Delivery Order is
 * always included, whatever its status, and its own lines never count against
 * the room.
 */
export async function deliveryNoteOptions(
  current: { id: number; deliveryOrderId: number } | null = null
): Promise<DeliveryNoteOptions> {
  const issued = (await sourceOptions(prisma, { issuedOnly: true }, current?.id ?? null)).filter(
    (o) => o.id === current?.deliveryOrderId || o.lines.some((l) => units(l.qty) > units(l.held))
  );
  if (current && !issued.some((o) => o.id === current.deliveryOrderId)) {
    issued.push(...(await sourceOptions(prisma, { ids: [current.deliveryOrderId] }, current.id)));
  }
  return { orders: issued };
}

// ------------------------------------------------------------- validation

type CheckedLine = { line_no: number; delivery_order_line_id: number; qty: number; note: string | null };

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
 * the posting transaction with the Customer Order locked, to be posted.
 */
export async function checkDeliveryNote(
  db: Db,
  header: DeliveryNoteHeaderInput,
  lines: DeliveryNoteLineInput[],
  selfId: number | null
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
      out.push({ line_no: out.length + 1, delivery_order_line_id: lineId, qty: fromUnits(units(qty)), note: text(l.note) });
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
          lines: { create: r.c.lines },
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
      // A Draft's lines are rewritten whole: nothing names a Delivery Note line yet.
      await tx.salDeliveryNoteLine.deleteMany({ where: { delivery_note_id: id } });
      await tx.salDeliveryNoteLine.createMany({ data: r.c.lines.map((l) => ({ ...l, delivery_note_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, dnNo: current.dn_no };
  });
}

function asInput(n: Prisma.SalDeliveryNoteGetPayload<{ include: { lines: true } }>): {
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
      .map((l) => ({ delivery_order_line_id: l.delivery_order_line_id, qty: l.qty.toNumber(), note: l.note ?? "" })),
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
  accounts: { cogs: PreviewAccount | null; inventory: PreviewAccount | null; missing: string[] };
};

export async function deliveryNotePreview(id: number): Promise<DeliveryNotePreview | null> {
  const n = await prisma.salDeliveryNote.findUnique({ where: { id }, include: { lines: true } });
  if (!n) return null;
  const [source] = await deliveryNoteSources({ ids: [n.delivery_order_id] });
  const byId = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const docLines = [...n.lines].sort((a, b) => a.line_no - b.line_no);
  const valuation = await issueValuation([...new Set(docLines.map((l) => byId.get(l.delivery_order_line_id)?.itemId ?? 0))]);
  const lines = docLines.map((l) => {
    const d = byId.get(l.delivery_order_line_id);
    const qty = l.qty.toNumber();
    const baseQty = fromUnits(units(qty * (d?.uomFactor ?? 1)));
    const unitCost = valuation.get(d?.itemId ?? 0) ?? null;
    return {
      itemLabel: d?.itemLabel ?? "",
      itemName: d?.itemName ?? "",
      qty,
      uomLabel: d?.uomLabel ?? "",
      baseQty,
      unitCost,
      cost: unitCost === null ? 0 : Math.round(baseQty * unitCost),
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
  const note = await prisma.salDeliveryNote.findUnique({ where: { id }, include: { lines: true } });
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
      const r = await checkDeliveryNote(tx, input.header, input.lines, id);
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
        const issued = await issueStock(tx, {
          itemId: d.itemId,
          warehouseId: r.c.source.warehouseId,
          baseQty,
          date: r.c.data.dn_date,
          source: { docTypeId: typeId, docId: id, no: note.dn_no },
          actorId,
        });
        await tx.salDeliveryNoteLine.update({
          where: { delivery_note_id_delivery_order_line_id: { delivery_note_id: id, delivery_order_line_id: line.delivery_order_line_id } },
          data: { base_qty: baseQty, unit_cost: issued.unitCost, cost_amount: issued.cost },
        });
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
  lines: (DeliveryNoteLineInput & { baseQty: number; unitCost: number; cost: number })[];
  cost: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
};

export async function getDeliveryNote(id: number): Promise<DeliveryNoteView | null> {
  const n = await prisma.salDeliveryNote.findUnique({ where: { id }, include: { lines: true } });
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
      baseQty: sorted[i].base_qty.toNumber(),
      unitCost: sorted[i].unit_cost.toNumber(),
      cost: sorted[i].cost_amount.toNumber(),
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
