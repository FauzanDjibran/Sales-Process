import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatNumber } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate, holdPostingPeriod, PeriodShut } from "./fiscal";
import { InventoryRefusal, increaseValue, issueStock, locationLabelsByIds, lockItemPools, lotTrackedItems, receiveStock, stockBuckets, trackingsByNo, warehouseLocationOptions } from "./inventory";
import { accountsForItems } from "./item-account";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { fallbackAccounts, isTransitWarehouse, notTransitWarehouse, TRANSIT_WAREHOUSE_REFUSED } from "./system-settings";
import { STOCK_ADJUSTMENT_TRANSITIONS, stockAdjustmentIsEditable, type StockAdjustmentAction, type StockAdjustmentStatus } from "./stock-adjustment-workflow";

/**
 * The Stock Adjustment (P318, `Goods-Movement-Plan.md` §3.4): a count of one
 * warehouse, and what it found missing or extra. Its tables are
 * `log_stock_adjustment` and `log_stock_adjustment_line`, and nothing else names
 * them. A line is one bucket — item, No. Lot, location, status — with what the
 * books held when it was counted and what is really there; a lot found where the
 * books hold none is added by its number, which must be one of that item's.
 *
 * **A count is only good against the balance it was made of**: a bucket that has
 * changed since refuses its line, at Simpan, at Ajukan and at Posting, and is
 * counted again.
 *
 * **Posting** (the approval), in one transaction: the items' pools are locked,
 * then every shortage leaves at the moving average (`issueStock`) before any
 * excess comes in, so the order never decides the value. An excess takes
 * round(V × q ÷ Q) of its pool (KB stock-books rule 7); with the pool empty the
 * value typed on the line. One journal per item, **Dr Selisih Persediaan / Cr
 * Persediaan** for a shortage and the reverse for an excess (Persediaan is the
 * Kategori Item's, else Account Mapping's). A count that found nothing posts
 * nothing.
 *
 * shortcut: the Gudang Transit is refused, because a shortage there must also
 * settle its Transfer Kirim (step 8b, with the transfer's own closing).
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;

export type StockAdjustmentHeaderInput = { adjustment_date: string; warehouse_id: number | null; note: string };
export type StockAdjustmentLineInput = {
  item_id: number | null;
  tracking_no: string;
  location_id: number | null;
  stock_status_id: number | null;
  /** What the books held when it was counted. */
  book_qty: number | string;
  /** Empty while not counted yet. */
  counted_qty: number | string;
  /** Rupiah, for an excess of an item the company holds none of. */
  value: number | string;
  note: string;
};
export type StockAdjustmentResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;
/** The books keep six decimals; compared in millionths. */
const SCALE = 1_000_000;
const micro = (n: number) => Math.round(n * SCALE);
const parse = (v: unknown) => Number(String(v ?? "").replace(",", "."));
const qtyText = (n: number) => formatNumber(n, n % 1 ? 4 : 0);

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
    if (e instanceof InventoryRefusal) return { ok: false, errors: { _form: `Belum bisa diproses: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "log_stock_adjustment", row_id: id, action, event, by } });
}

// ---------------------------------------------------------------- options

export type AdjustmentPlace = { id: number; label: string; name: string; active: boolean };
export type StockAdjustmentOptions = {
  warehouses: AdjustmentPlace[];
  items: { id: number; label: string; name: string; uomLabel: string; active: boolean }[];
  statuses: { id: number; label: string; name: string }[];
};

/** `mine`: the warehouses the user works in (OD-9), or null for all; `keep`: a stored count's own. */
export async function stockAdjustmentOptions(mine: number[] | null, keep: number | null = null, db: Db = prisma): Promise<StockAdjustmentOptions> {
  const [warehouses, items, statuses] = await Promise.all([
    db.refWarehouse.findMany({
      where: { AND: [await notTransitWarehouse(), { OR: [{ status: "Active", ...(mine ? { id: { in: mine } } : {}) }, ...(keep ? [{ id: keep }] : [])] }] },
      orderBy: { warehouse_label: "asc" },
    }),
    db.mItem.findMany({ where: { item_type: "Barang", track_stock: true }, orderBy: { item_label: "asc" }, select: { id: true, item_label: true, item_name: true, status: true, base_uom: { select: { uom_label: true } } } }),
    db.sysStockStatus.findMany({ orderBy: { sort_order: "asc" } }),
  ]);
  return {
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, active: w.status === "Active" })),
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, uomLabel: i.base_uom.uom_label, active: i.status === "Active" })),
    statuses: statuses.map((s) => ({ id: s.id, label: s.status_label, name: s.status_name })),
  };
}

export type CountSheet = {
  locations: { id: number; label: string; name: string }[];
  rows: { item_id: number; tracking_no: string; location_id: number | null; stock_status_id: number; book_qty: number }[];
};

/** What the books hold in a warehouse now, a row per bucket: the sheet that is counted. */
export async function countSheet(warehouseId: number): Promise<CountSheet> {
  const [buckets, locations] = await Promise.all([stockBuckets(warehouseId), warehouseLocationOptions([warehouseId])]);
  return {
    locations: (locations.get(warehouseId) ?? []).map((l) => ({ id: l.id, label: l.label, name: l.name })),
    rows: buckets.map((b) => ({ item_id: b.itemId, tracking_no: b.trackingNo, location_id: b.locationId, stock_status_id: b.statusId, book_qty: b.qty })),
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = {
  line_no: number;
  item_id: number;
  tracking_id: number;
  tracking_no: string;
  location_id: number | null;
  stock_status_id: number;
  book_qty: number;
  counted_qty: number | null;
  typed_value: number | null;
  note: string | null;
};

type Checked = { data: { adjustment_date: Date; warehouse_id: number; note: string | null }; warehouseLabel: string; lines: CheckedLine[]; itemLabels: Map<number, string> };

/** Every rule of a count; `complete` (Ajukan and Posting) also needs every line counted. */
async function check(db: Db, header: StockAdjustmentHeaderInput, lines: StockAdjustmentLineInput[], complete: boolean): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const warehouseId = Number(header.warehouse_id) || null;
  const warehouse = warehouseId ? await db.refWarehouse.findUnique({ where: { id: warehouseId } }) : null;
  if (!warehouseId) errors.warehouse_id = "Pilih gudang.";
  else if (await isTransitWarehouse(warehouseId, db)) errors.warehouse_id = TRANSIT_WAREHOUSE_REFUSED;
  else if (!warehouse || warehouse.status !== "Active") errors.warehouse_id = "Gudang tidak ditemukan atau nonaktif.";
  const date = String(header.adjustment_date ?? "").trim();
  if (!DAY.test(date)) errors.adjustment_date = "Tanggal wajib diisi.";

  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Muat saldo gudang atau tambahkan barang yang dihitung.";
  const itemIds = [...new Set(raw.flatMap((l) => (Number(l.item_id) ? [Number(l.item_id)] : [])))];
  const [tracked, items, trackings, statuses, places, buckets] = await Promise.all([
    lotTrackedItems(itemIds, db),
    db.mItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, item_label: true } }),
    trackingsByNo(db, raw.map((l) => String(l.tracking_no ?? "").trim().toUpperCase())),
    db.sysStockStatus.findMany({ select: { id: true } }),
    warehouseId ? warehouseLocationOptions([warehouseId], db) : new Map(),
    warehouseId ? stockBuckets(warehouseId, db) : [],
  ]);
  const itemLabels = new Map(items.map((i) => [i.id, i.item_label]));
  const locations: { id: number }[] = warehouseId ? (places.get(warehouseId) ?? []) : [];
  const held = new Map(buckets.map((b) => [`${b.trackingId}|${b.locationId ?? 0}|${b.statusId}`, b.qty]));
  const seen = new Set<string>();
  const out: CheckedLine[] = [];
  for (const [i, l] of raw.entries()) {
    const itemId = Number(l.item_id) || 0;
    if (!tracked.has(itemId)) {
      errors[lineKey(i, "item_id")] = "Pilih Barang dengan Kelola Stok.";
      continue;
    }
    const no = String(l.tracking_no ?? "").trim().toUpperCase();
    const lot = trackings.get(no);
    if (!no || !lot || lot.itemId !== itemId) {
      errors[lineKey(i, "tracking_no")] = no ? `Lot ${no} bukan lot ${itemLabels.get(itemId) ?? "barang ini"}.` : "Isi nomor lot.";
      continue;
    }
    const locationId = Number(l.location_id) || null;
    if (locations.length ? !locations.some((x) => x.id === locationId) : locationId) {
      errors[lineKey(i, "location_id")] = locations.length ? "Pilih lokasi di gudang ini." : "Gudang ini tidak memakai lokasi.";
      continue;
    }
    const statusId = Number(l.stock_status_id) || 0;
    if (!statuses.some((s) => s.id === statusId)) {
      errors[lineKey(i, "stock_status_id")] = "Pilih status stok.";
      continue;
    }
    const key = `${lot.id}|${locationId ?? 0}|${statusId}`;
    if (seen.has(key)) {
      errors[lineKey(i, "tracking_no")] = `Lot ${no} di tempat dan status ini sudah ada di baris lain.`;
      continue;
    }
    seen.add(key);
    const book = held.get(key) ?? 0;
    const blank = String(l.counted_qty ?? "").trim() === "";
    const counted = blank ? null : parse(l.counted_qty);
    if (counted !== null && (!Number.isFinite(counted) || counted < 0)) {
      errors[lineKey(i, "counted_qty")] = "Isi jumlah fisik, minimal 0.";
      continue;
    }
    if (counted !== null && Math.abs(counted * SCALE - micro(counted)) > 1e-3) {
      errors[lineKey(i, "counted_qty")] = "Paling banyak 6 angka desimal.";
      continue;
    }
    if (counted === null && complete) {
      errors[lineKey(i, "counted_qty")] = "Belum dihitung.";
      continue;
    }
    if (counted !== null && micro(parse(l.book_qty)) !== micro(book)) {
      errors[lineKey(i, "counted_qty")] = `Saldo buku ${no} berubah dari ${qtyText(parse(l.book_qty) || 0)} menjadi ${qtyText(book)}. Muat ulang saldo dan hitung lagi.`;
      continue;
    }
    const typed = String(l.value ?? "").trim() === "" ? null : parse(l.value);
    if (typed !== null && (!Number.isInteger(typed) || typed < 0)) {
      errors[lineKey(i, "value")] = "Nilai harus rupiah utuh.";
      continue;
    }
    out.push({ line_no: out.length + 1, item_id: itemId, tracking_id: lot.id, tracking_no: no, location_id: locationId, stock_status_id: statusId, book_qty: book, counted_qty: counted, typed_value: typed, note: text(l.note) });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length || !warehouse) return { ok: false, errors };
  return { ok: true, c: { data: { adjustment_date: asDate(date), warehouse_id: warehouse.id, note: text(header.note) }, warehouseLabel: warehouse.warehouse_label, lines: out, itemLabels } };
}

// ------------------------------------------------------------------ writes

const nextNo = (db: Db, date: Date) =>
  nextDocumentNumber("SA", date, async (series) => {
    const row = await db.logStockAdjustment.findFirst({ where: { adjustment_no: { startsWith: series } }, orderBy: { adjustment_no: "desc" }, select: { adjustment_no: true } });
    return row?.adjustment_no ?? null;
  });

export async function createStockAdjustment(header: StockAdjustmentHeaderInput, lines: StockAdjustmentLineInput[], actorId: number): Promise<StockAdjustmentResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await check(tx, header, lines, false);
      if (!r.ok) throw new Refused(r.errors);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('log_stock_adjustment_no'))`;
      const row = await tx.logStockAdjustment.create({ data: { ...r.c.data, adjustment_no: await nextNo(tx, r.c.data.adjustment_date), created_by: actorId, lines: { create: r.c.lines } } });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, no: made.adjustment_no };
  });
}

export async function updateStockAdjustment(id: number, header: StockAdjustmentHeaderInput, lines: StockAdjustmentLineInput[], actorId: number): Promise<StockAdjustmentResult> {
  const current = await prisma.logStockAdjustment.findUnique({ where: { id }, select: { status: true, adjustment_no: true } });
  if (!current) return { ok: false, errors: { _form: "Stock Adjustment tidak ditemukan." } };
  if (!stockAdjustmentIsEditable(current.status as StockAdjustmentStatus)) return { ok: false, errors: { _form: "Stock Adjustment yang sudah diajukan tidak dapat diubah." } };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const r = await check(tx, header, lines, false);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.logStockAdjustment.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Stock Adjustment berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines are rewritten whole: nothing names them yet.
      await tx.logStockAdjustmentLine.deleteMany({ where: { stock_adjustment_id: id } });
      await tx.logStockAdjustmentLine.createMany({ data: r.c.lines.map((l) => ({ ...l, stock_adjustment_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, no: current.adjustment_no };
  });
}

const WITH_LINES = { warehouse: true, lines: { orderBy: { line_no: "asc" as const } } };
type Stored = Prisma.LogStockAdjustmentGetPayload<{ include: typeof WITH_LINES }>;

const asInput = (a: Stored): { header: StockAdjustmentHeaderInput; lines: StockAdjustmentLineInput[] } => ({
  header: { adjustment_date: isoDay(a.adjustment_date), warehouse_id: a.warehouse_id, note: a.note ?? "" },
  lines: a.lines.map((l) => ({
    item_id: l.item_id,
    tracking_no: l.tracking_no,
    location_id: l.location_id,
    stock_status_id: l.stock_status_id,
    book_qty: l.book_qty.toNumber(),
    counted_qty: l.counted_qty === null ? "" : l.counted_qty.toNumber(),
    value: l.typed_value === null ? "" : l.typed_value.toNumber(),
    note: l.note ?? "",
  })),
});

/** The journal the approval would write: the posting itself, rolled back (P103). */
export async function stockAdjustmentPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  const r = await transitionStockAdjustment(id, "approve", actorId, undefined, { dryRun: true });
  return r.ok ? { ok: true, lines: await describeJournalLines(r.journal ?? []) } : r;
}

export async function transitionStockAdjustment(
  id: number,
  action: StockAdjustmentAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean } = {}
): Promise<{ ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> }> {
  const a = await prisma.logStockAdjustment.findUnique({ where: { id }, include: WITH_LINES });
  if (!a) return { ok: false, errors: { _form: "Stock Adjustment tidak ditemukan." } };
  const t = STOCK_ADJUSTMENT_TRANSITIONS[action];
  if (!t || !t.from.includes(a.status as StockAdjustmentStatus)) return { ok: false, errors: { _form: "Status dokumen sudah berubah. Muat ulang." } };
  const why = t.reason ? text(reason) : null;
  if (t.reason && !why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  const input = asInput(a);
  const claim = async (tx: Tx) => {
    const done = await tx.logStockAdjustment.updateMany({ where: { id, status: t.from[0] }, data: { status: t.to, updated_by: actorId, ...(why ? { status_reason: why } : {}) } });
    if (done.count !== 1) throw new Refused({ _form: "Status dokumen sudah berubah. Muat ulang." });
    await audit(tx, id, "UPDATE", action, actorId);
  };
  const recheck = async (tx: Tx) => {
    const r = await check(tx, input.header, input.lines, true);
    if (!r.ok) throw new Refused({ _form: `Belum bisa diproses: ${Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines}` });
    return r.c;
  };

  if (action !== "approve") {
    return refusable(async () => {
      await prisma.$transaction(async (tx) => {
        if (action === "submit") await recheck(tx);
        await claim(tx);
      });
      return { ok: true as const };
    });
  }

  const day = isoDay(a.adjustment_date);
  const period = await checkTransactionDate(day);
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, day);
      // Every movement of an item locks its pool first, so from here its buckets stand still.
      await lockItemPools(tx, a.lines.map((l) => l.item_id), actorId);
      const c = await recheck(tx);
      await claim(tx);
      const typeId = (await tx.sysDocType.findFirst({ where: { doc_table: "log_stock_adjustment" }, select: { id: true } }))?.id;
      if (!typeId) throw new Refused({ _form: "Tipe dokumen Stock Adjustment belum ada. Jalankan npm run db:seed." });
      const source = { docTypeId: typeId, docId: id, no: a.adjustment_no };
      const date = c.data.adjustment_date;
      const diffOf = (l: CheckedLine) => micro(l.counted_qty!) - micro(l.book_qty);
      const perItem = new Map<number, { short: number; over: number }>();
      const book = (itemId: number, value: number) => {
        const p = perItem.get(itemId) ?? { short: 0, over: 0 };
        if (value < 0) p.short -= value;
        else p.over += value;
        perItem.set(itemId, p);
      };
      // Shortages first, then excesses: the order never decides the value.
      const ordered = [...c.lines.filter((l) => diffOf(l) < 0), ...c.lines.filter((l) => diffOf(l) > 0)];
      for (const l of ordered) {
        const diff = diffOf(l) / SCALE;
        const place = { itemId: l.item_id, warehouseId: c.data.warehouse_id, locationId: l.location_id, statusId: l.stock_status_id, date, source, actorId };
        let value: number;
        if (diff < 0) {
          value = -(await issueStock(tx, { ...place, lotId: l.tracking_id, baseQty: -diff })).cost;
        } else {
          const average = await increaseValue(tx, l.item_id, diff);
          if (average === null && l.typed_value === null) throw new Refused({ _form: `Stok ${c.itemLabels.get(l.item_id)} kosong, jadi belum punya harga pokok: isi nilai lebihnya di baris lot ${l.tracking_no}.` });
          value = average ?? l.typed_value!;
          await receiveStock(tx, { ...place, lotNo: l.tracking_no, expiry: null, baseQty: diff, value });
        }
        await tx.logStockAdjustmentLine.updateMany({ where: { stock_adjustment_id: id, line_no: l.line_no }, data: { value_amount: value } });
        book(l.item_id, value);
      }

      const journalLines: JournalLineInput[] = [];
      const moved = [...perItem].filter(([, p]) => p.short || p.over);
      if (moved.length) {
        const fallback = await fallbackAccounts(["inventory_account", "stock_difference_account"] as const);
        const byCategory = await accountsForItems(moved.map(([itemId]) => itemId), tx);
        const base = await tx.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
        if (!base) throw new Refused({ _form: "Mata uang dasar tidak ditemukan." });
        if (!fallback.stock_difference_account) throw new Refused({ _form: "Lengkapi Account Mapping dulu: Account Selisih Persediaan." });
        for (const [itemId, p] of moved) {
          const inventory = byCategory.get(itemId)?.inventory ?? fallback.inventory_account;
          const label = c.itemLabels.get(itemId) ?? "";
          if (!inventory) throw new Refused({ _form: `Lengkapi Account Kategori Item dulu: Account Persediaan untuk ${label}.` });
          const pair = (debit: number, credit: number, amount: number, what: string) => {
            if (!amount) return;
            const description = `${what} ${label} · ${c.warehouseLabel}`;
            journalLines.push({ accountId: debit, currencyId: base.id, rate: 1, debit: amount, credit: 0, description }, { accountId: credit, currencyId: base.id, rate: 1, debit: 0, credit: amount, description });
          };
          pair(fallback.stock_difference_account, inventory, p.short, "Kurang");
          pair(inventory, fallback.stock_difference_account, p.over, "Lebih");
        }
      }
      const journal = journalLines.length
        ? await postJournal(tx, { description: `${a.adjustment_no} · Stock Adjustment ${c.warehouseLabel}`, sourceDocTypeId: typeId, sourceDocId: id, postingDate: date, actorId, lines: journalLines })
        : null;
      const sum = (k: "short" | "over") => [...perItem.values()].reduce((x, p) => x + p[k], 0);
      await tx.logStockAdjustment.update({ where: { id }, data: { journal_id: journal?.id ?? null, short_amount: sum("short"), over_amount: sum("over") } });
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type StockAdjustmentListRow = { id: number; no: string; date: string; status: StockAdjustmentStatus; warehouseLabel: string; warehouseName: string; lines: number; net: number };

/** `warehouses`: the actor's (OD-9), or null for all. */
export async function listStockAdjustments(warehouses: number[] | null = null): Promise<StockAdjustmentListRow[]> {
  const rows = await prisma.logStockAdjustment.findMany({
    where: warehouses ? { warehouse_id: { in: warehouses } } : undefined,
    orderBy: [{ adjustment_date: "desc" }, { id: "desc" }],
    include: { warehouse: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    no: r.adjustment_no,
    date: isoDay(r.adjustment_date),
    status: r.status as StockAdjustmentStatus,
    warehouseLabel: r.warehouse.warehouse_label,
    warehouseName: r.warehouse.warehouse_name,
    lines: r._count.lines,
    net: r.over_amount.sub(r.short_amount).toNumber(),
  }));
}

export type StockAdjustmentView = {
  id: number;
  no: string;
  status: StockAdjustmentStatus;
  header: StockAdjustmentHeaderInput;
  warehouse: { id: number; label: string; name: string };
  lines: (StockAdjustmentLineInput & { locationLabel: string | null; valueAmount: number })[];
  short: number;
  over: number;
  journalId: number | null;
  journalNo: string | null;
  reason: string | null;
};

export async function getStockAdjustment(id: number): Promise<StockAdjustmentView | null> {
  const a = await prisma.logStockAdjustment.findUnique({ where: { id }, include: WITH_LINES });
  if (!a) return null;
  const [labels, journals] = await Promise.all([
    locationLabelsByIds(a.lines.flatMap((l) => (l.location_id ? [l.location_id] : []))),
    a.journal_id ? journalNumbersByIds([a.journal_id]) : new Map<number, string>(),
  ]);
  const input = asInput(a);
  return {
    id: a.id,
    no: a.adjustment_no,
    status: a.status as StockAdjustmentStatus,
    header: input.header,
    warehouse: { id: a.warehouse_id, label: a.warehouse.warehouse_label, name: a.warehouse.warehouse_name },
    lines: input.lines.map((l, i) => ({ ...l, locationLabel: l.location_id ? (labels.get(l.location_id) ?? null) : null, valueAmount: a.lines[i].value_amount.toNumber() })),
    short: a.short_amount.toNumber(),
    over: a.over_amount.toNumber(),
    journalId: a.journal_id,
    journalNo: a.journal_id ? (journals.get(a.journal_id) ?? null) : null,
    reason: a.status_reason,
  };
}

export async function stockAdjustmentWarehouse(id: number): Promise<number | null> {
  return (await prisma.logStockAdjustment.findUnique({ where: { id }, select: { warehouse_id: true } }))?.warehouse_id ?? null;
}

export async function stockAdjustmentNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logStockAdjustment.findMany({ where: { id: { in: ids } }, select: { id: true, adjustment_no: true } });
  return new Map(rows.map((r) => [r.id, r.adjustment_no]));
}

/** For the Lokasi Gudang master (P267): the counts open on a warehouse, and the locations any count names. */
export async function stockAdjustmentLocationUse(warehouseId: number, locationIds: number[]): Promise<{ drafts: number; named: Set<number> }> {
  const [drafts, named] = await Promise.all([
    prisma.logStockAdjustment.count({ where: { warehouse_id: warehouseId, status: { in: ["Draft", "Submitted"] } } }),
    locationIds.length ? prisma.logStockAdjustmentLine.findMany({ where: { location_id: { in: locationIds } }, distinct: ["location_id"], select: { location_id: true } }) : [],
  ]);
  return { drafts, named: new Set(named.flatMap((r) => (r.location_id ? [r.location_id] : []))) };
}
