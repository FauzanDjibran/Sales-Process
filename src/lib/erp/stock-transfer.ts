import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatNumber } from "@/lib/format";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate, holdPostingPeriod, PeriodShut } from "./fiscal";
import { InventoryRefusal, issueStock, locationLabelsByIds, lotOptions, lotTrackedItems, receiveStock, type LotOption } from "./inventory";
import { transitWarehouseId } from "./system-settings";
import {
  STOCK_TRANSFER_TRANSITIONS,
  stockTransferIsEditable,
  stockTransferTransitionAllowed,
  type StockTransferAction,
  type StockTransferStatus,
} from "./stock-transfer-workflow";

/**
 * Transfer Kirim (P300, `Stock-Transfer-Plan.md` §3.1): its tables are
 * `log_stock_transfer`, `log_stock_transfer_line` and
 * `log_stock_transfer_tracking`, and nothing else names them. Transfer Terima
 * (`stock-transfer-receipt.ts`) reaches them through the functions at the foot.
 *
 * The user names the origin and destination warehouses — neither the Gudang
 * Transit (OD-2) — the day, and each Barang with Kelola Stok in its base unit,
 * picked by lot, location and status from the origin; any status may travel
 * (OD-4). A Draft may be picked in part, Kirim needs every line in full.
 *
 * **Kirim**, in one transaction with the period held: every pick is issued
 * from the origin (`issueStock`, at the moving average) and received into the
 * Gudang Transit under the same lot and status at **the value just released**
 * (`receiveStock`), so the item's pool ends at exactly the quantity and value
 * it started with and its average does not move (OD-6). No journal: nothing in
 * the General Ledger changes. The transit warehouse is copied from System
 * Default onto the document.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type StockTransferHeaderInput = {
  transfer_date: string;
  from_warehouse_id: number | null;
  to_warehouse_id: number | null;
  vehicle_no: string;
  driver_name: string;
  note: string;
};

export type StockTransferPickInput = { tracking_id: number | null; location_id?: number | null; stock_status_id?: number | null; qty: number | string };

export type StockTransferLineInput = { item_id: number | null; qty: number | string; note: string; picks?: StockTransferPickInput[] };

export type StockTransferResult = { ok: true; id: number; transferNo: string } | { ok: false; errors: Record<string, string> };

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
const parseQty = (v: unknown) => Number(String(v ?? "").replace(",", "."));

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
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
    if (e instanceof InventoryRefusal) return { ok: false, errors: { _form: `Belum bisa dikirim: ${e.message}` } };
    throw e;
  }
}

// ---------------------------------------------------------------- options

export type TransferPlace = { id: number; label: string; name: string; active: boolean };
export type TransferItem = { id: number; label: string; name: string; uomId: number; uomLabel: string; active: boolean };

export type StockTransferOptions = {
  /** Warehouses the user may send from: theirs, never the transit (OD-2, OD-9). */
  fromWarehouses: TransferPlace[];
  /** Every active warehouse but the transit: the sender chooses, without seeing its stock. */
  toWarehouses: TransferPlace[];
  /** The Gudang Transit set in System Default, or null while unset. */
  transit: TransferPlace | null;
  items: TransferItem[];
  /** Lots per origin warehouse id, then item id, in every stock status (OD-4); FEFO. */
  lots: Record<number, Record<number, LotOption[]>>;
};

/**
 * What the form offers. `scope` is the warehouses the user works in (null:
 * every one); `current` a stored transfer, whose warehouses, items and lots
 * stay readable whatever their state now.
 */
export async function stockTransferOptions(
  scope: number[] | null,
  current: { fromId: number; toId: number; itemIds: number[]; lotIds: number[] } | null = null,
  db: Db = prisma
): Promise<StockTransferOptions> {
  const transitId = await transitWarehouseId(db);
  const keep = current ? [current.fromId, current.toId] : [];
  const [warehouses, items, statuses] = await Promise.all([
    db.refWarehouse.findMany({ where: { OR: [{ status: "Active" }, { id: { in: [...keep, ...(transitId ? [transitId] : [])] } }] }, orderBy: { warehouse_label: "asc" } }),
    db.mItem.findMany({
      where: { item_type: "Barang", track_stock: true, OR: [{ status: "Active" }, ...(current?.itemIds.length ? [{ id: { in: current.itemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      select: { id: true, item_label: true, item_name: true, status: true, base_uom_id: true, base_uom: { select: { uom_label: true } } },
    }),
    db.sysStockStatus.findMany({ select: { status_label: true } }),
  ]);
  const place = (w: (typeof warehouses)[number]): TransferPlace => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, active: w.status === "Active" });
  const plain = warehouses.filter((w) => w.id !== transitId);
  const fromWarehouses = plain.filter((w) => (w.status === "Active" && (scope === null || scope.includes(w.id))) || w.id === current?.fromId).map(place);
  const toWarehouses = plain.filter((w) => w.status === "Active" || w.id === current?.toId).map(place);
  const transitRow = transitId ? warehouses.find((w) => w.id === transitId) : undefined;
  const byWarehouse = await lotOptions(
    items.map((i) => i.id),
    fromWarehouses.map((w) => w.id),
    db,
    current?.lotIds ?? [],
    statuses.map((s) => s.status_label)
  );
  const lots: StockTransferOptions["lots"] = {};
  for (const [w, byItem] of byWarehouse) lots[w] = Object.fromEntries(byItem.entries());
  return {
    fromWarehouses,
    toWarehouses,
    transit: transitRow ? place(transitRow) : null,
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, uomId: i.base_uom_id, uomLabel: i.base_uom.uom_label, active: i.status === "Active" })),
    lots,
  };
}

// ------------------------------------------------------------- validation

type CheckedPick = { pick_no: number; tracking_id: number; location_id: number | null; stock_status_id: number; tracking_no: string; expiry_date: Date | null; base_qty: number };
type CheckedLine = { line_no: number; item_id: number; uom_id: number; base_qty: number; note: string | null; picks: CheckedPick[] };
type Checked = {
  data: { transfer_date: Date; from_warehouse_id: number; to_warehouse_id: number; vehicle_no: string | null; driver_name: string | null; note: string | null };
  fromLabel: string;
  toLabel: string;
  lines: CheckedLine[];
};

/**
 * Every rule a Transfer Kirim must satisfy to be saved — and, run again inside
 * the Kirim transaction with `forPosting`, to be sent: every line then picked
 * in full, the warehouses and items still active. Which warehouses the user may
 * send from is the action's question (OD-9).
 */
export async function checkStockTransfer(
  db: Db,
  header: StockTransferHeaderInput,
  lines: StockTransferLineInput[],
  selfId: number | null,
  forPosting = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const stored = selfId
    ? await db.logStockTransfer.findUnique({
        where: { id: selfId },
        select: { from_warehouse_id: true, to_warehouse_id: true, lines: { select: { item_id: true, trackings: { select: { tracking_id: true } } } } },
      })
    : null;
  const options = await stockTransferOptions(
    null,
    stored
      ? {
          fromId: stored.from_warehouse_id,
          toId: stored.to_warehouse_id,
          itemIds: stored.lines.map((l) => l.item_id),
          lotIds: stored.lines.flatMap((l) => l.trackings.map((t) => t.tracking_id)),
        }
      : null,
    db
  );
  const transitId = options.transit?.id ?? null;

  const date = String(header.transfer_date ?? "").trim();
  if (!DAY.test(date)) errors.transfer_date = "Tanggal Kirim wajib diisi.";

  const pickPlace = (raw: number | null, field: "from_warehouse_id" | "to_warehouse_id", list: TransferPlace[], wasId: number | undefined) => {
    const id = Number(raw) || null;
    if (!id) {
      errors[field] = field === "from_warehouse_id" ? "Pilih Gudang Asal." : "Pilih Gudang Tujuan.";
      return undefined;
    }
    if (id === transitId) {
      errors[field] = "Gudang Transit tidak dapat menjadi asal atau tujuan Transfer.";
      return undefined;
    }
    const w = list.find((x) => x.id === id);
    if (!w || (!w.active && (forPosting || wasId !== id))) {
      errors[field] = "Gudang tidak ditemukan atau nonaktif.";
      return undefined;
    }
    return w;
  };
  const from = pickPlace(header.from_warehouse_id, "from_warehouse_id", options.fromWarehouses, stored?.from_warehouse_id);
  const to = pickPlace(header.to_warehouse_id, "to_warehouse_id", options.toWarehouses, stored?.to_warehouse_id);
  if (from && to && from.id === to.id) errors.to_warehouse_id = "Gudang Tujuan harus berbeda dari Gudang Asal. Pindah lokasi di satu gudang belum didukung.";

  const raw = Array.isArray(lines) ? lines : [];
  const out: CheckedLine[] = [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu barang.";
  const itemById = new Map(options.items.map((i) => [i.id, i]));
  const tracked = await lotTrackedItems([...itemById.keys()], db);
  const seen = new Set<number>();
  for (const [i, l] of raw.entries()) {
    const itemId = Number(l.item_id) || null;
    const item = itemId ? itemById.get(itemId) : undefined;
    if (!itemId) {
      errors[lineKey(i, "item_id")] = "Pilih barang.";
      continue;
    }
    if (!item || !tracked.has(item.id)) {
      errors[lineKey(i, "item_id")] = "Hanya Barang dengan Kelola Stok yang dapat ditransfer.";
      continue;
    }
    if (!item.active && forPosting) {
      errors[lineKey(i, "item_id")] = `${item.label} nonaktif.`;
      continue;
    }
    if (seen.has(item.id)) {
      errors[lineKey(i, "item_id")] = `${item.label} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(item.id);
    const qty = parseQty(l.qty);
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    const lots = from ? (options.lots[from.id]?.[item.id] ?? []) : [];
    const picks = checkPicks(l.picks, item, lots, fromUnits(units(qty)), forPosting);
    if (!picks.ok) {
      errors[lineKey(i, "picks")] = picks.error;
      continue;
    }
    out.push({ line_no: out.length + 1, item_id: item.id, uom_id: item.uomId, base_qty: fromUnits(units(qty)), note: text(l.note), picks: picks.picks });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";

  if (Object.keys(errors).length || !from || !to) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        transfer_date: asDate(date),
        from_warehouse_id: from.id,
        to_warehouse_id: to.id,
        vehicle_no: text(header.vehicle_no),
        driver_name: text(header.driver_name),
        note: text(header.note),
      },
      fromLabel: from.label,
      toLabel: to.label,
      lines: out,
    },
  };
}

/**
 * A line's picking: buckets of its item in the origin — lot, location and
 * status — each once, each more than 0, together never more than the line and,
 * to be sent, exactly it.
 */
function checkPicks(
  raw: StockTransferPickInput[] | undefined,
  item: TransferItem,
  lots: LotOption[],
  lineQty: number,
  forPosting: boolean
): { ok: true; picks: CheckedPick[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const picks: CheckedPick[] = [];
  let total = 0;
  for (const p of list) {
    const lot = lots.find(
      (o) => o.id === Number(p.tracking_id) && o.locationId === (Number(p.location_id) || null) && (p.stock_status_id == null || o.statusId === Number(p.stock_status_id))
    );
    if (!lot) return { ok: false, error: `Lot tidak ada di gudang asal untuk ${item.label}. Pilih ulang lotnya.` };
    const where = `${lot.locationLabel ? ` di ${lot.locationLabel}` : ""}${lot.statusLabel !== "TERSEDIA" ? ` (${lot.statusName})` : ""}`;
    if (seen.has(lot.key)) return { ok: false, error: `Lot ${lot.lotNo}${where} dipilih lebih dari sekali.` };
    seen.add(lot.key);
    const qty = parseQty(p.qty);
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
  if (total > units(lineQty)) {
    return { ok: false, error: `Lot yang dipilih (${qtyText(fromUnits(total))}) melebihi Qty baris (${qtyText(lineQty)} ${item.uomLabel}).` };
  }
  if (forPosting && total !== units(lineQty)) {
    return { ok: false, error: `${item.label}: lot baru ${qtyText(fromUnits(total))} dari ${qtyText(lineQty)} ${item.uomLabel}. Pilih lot sampai penuh.` };
  }
  return { ok: true, picks };
}

// ------------------------------------------------------------------ writes

async function nextTransferNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("TSK", date, async (series) => {
    const row = await db.logStockTransfer.findFirst({ where: { transfer_no: { startsWith: series } }, orderBy: { transfer_no: "desc" }, select: { transfer_no: true } });
    return row?.transfer_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "log_stock_transfer", row_id: id, action, event, by } });
}

export async function createStockTransfer(header: StockTransferHeaderInput, lines: StockTransferLineInput[], actorId: number): Promise<StockTransferResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const r = await checkStockTransfer(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('log_stock_transfer_no'))`;
      const row = await tx.logStockTransfer.create({
        data: {
          ...r.c.data,
          transfer_no: await nextTransferNo(tx, r.c.data.transfer_date),
          created_by: actorId,
          lines: { create: r.c.lines.map(({ picks, ...l }) => ({ ...l, trackings: { create: picks } })) },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, transferNo: made.transfer_no };
  });
}

export async function updateStockTransfer(id: number, header: StockTransferHeaderInput, lines: StockTransferLineInput[], actorId: number): Promise<StockTransferResult> {
  const current = await prisma.logStockTransfer.findUnique({ where: { id }, select: { status: true, transfer_no: true } });
  if (!current) return { ok: false, errors: { _form: "Transfer Kirim tidak ditemukan." } };
  if (!stockTransferIsEditable(current.status as StockTransferStatus)) {
    return { ok: false, errors: { _form: "Transfer Kirim yang sudah dikirim atau dibatalkan tidak dapat diubah." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const r = await checkStockTransfer(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.logStockTransfer.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Transfer Kirim berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines and picks are rewritten whole: nothing names them yet.
      await tx.logStockTransferTracking.deleteMany({ where: { line: { stock_transfer_id: id } } });
      await tx.logStockTransferLine.deleteMany({ where: { stock_transfer_id: id } });
      for (const { picks, ...l } of r.c.lines) {
        await tx.logStockTransferLine.create({ data: { ...l, stock_transfer_id: id, trackings: { create: picks } } });
      }
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, transferNo: current.transfer_no };
  });
}

const WITH_PICKS = { lines: { include: { trackings: { orderBy: { pick_no: "asc" as const } } }, orderBy: { line_no: "asc" as const } } };
type StoredTransfer = Prisma.LogStockTransferGetPayload<{ include: typeof WITH_PICKS }>;

function asInput(n: StoredTransfer): { header: StockTransferHeaderInput; lines: StockTransferLineInput[] } {
  return {
    header: {
      transfer_date: isoDay(n.transfer_date),
      from_warehouse_id: n.from_warehouse_id,
      to_warehouse_id: n.to_warehouse_id,
      vehicle_no: n.vehicle_no ?? "",
      driver_name: n.driver_name ?? "",
      note: n.note ?? "",
    },
    lines: n.lines.map((l) => ({
      item_id: l.item_id,
      qty: l.base_qty.toNumber(),
      note: l.note ?? "",
      picks: l.trackings.map((p) => ({ tracking_id: p.tracking_id, location_id: p.location_id, stock_status_id: p.stock_status_id, qty: p.base_qty.toNumber() })),
    })),
  };
}

export type StockTransferTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Kirim**, in one transaction with the period held:
 * rechecks the stored transfer, takes the Gudang Transit from System Default,
 * and moves every pick from the origin into the transit under the same lot and
 * status at the value the origin released. **Batalkan** (Draft only) asks for
 * a reason. Every step is conditional on the status just read.
 */
export async function transitionStockTransfer(id: number, action: StockTransferAction, actorId: number, reason?: string): Promise<StockTransferTransitionResult> {
  const transfer = await prisma.logStockTransfer.findUnique({ where: { id }, include: WITH_PICKS });
  if (!transfer) return { ok: false, errors: { _form: "Transfer Kirim tidak ditemukan." } };
  const t = STOCK_TRANSFER_TRANSITIONS[action];
  if (!t || !stockTransferTransitionAllowed(action, transfer.status as StockTransferStatus)) {
    return { ok: false, errors: { _form: `Transfer Kirim berstatus ini tidak dapat di-${(t?.label ?? action).toLowerCase()}.` } };
  }
  const moved = "Transfer Kirim berubah saat diproses. Muat ulang halaman.";

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.logStockTransfer.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const day = isoDay(transfer.transfer_date);
  const period = await checkTransactionDate(day);
  if (!period.ok) return { ok: false, errors: { _form: period.message } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, day);
      const input = asInput(transfer);
      const r = await checkStockTransfer(tx, input.header, input.lines, id, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
        throw new Refused({ _form: `Belum bisa dikirim: ${first}` });
      }
      const transitId = await transitWarehouseId(tx);
      if (!transitId) throw new Refused({ _form: "Gudang Transit belum diatur di System Default › Persediaan." });
      const transit = await tx.refWarehouse.findUnique({ where: { id: transitId }, select: { status: true, _count: { select: { locations: true } } } });
      if (!transit || transit.status !== "Active") throw new Refused({ _form: "Gudang Transit di System Default tidak ditemukan atau nonaktif." });
      if (transit._count.locations) throw new Refused({ _form: "Gudang Transit tidak boleh memakai lokasi. Periksa System Default › Persediaan." });

      const done = await tx.logStockTransfer.updateMany({ where: { id, status: "Draft" }, data: { status: "InTransit", transit_warehouse_id: transitId, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const source = { docTypeId: await docTypeId(tx, "log_stock_transfer"), docId: id, no: transfer.transfer_no };
      const date = r.c.data.transfer_date;
      for (const line of r.c.lines) {
        for (const p of line.picks) {
          // Out of the origin at the moving average, then into the transit at
          // exactly that value: the pool ends where it started (OD-6).
          const out = await issueStock(tx, {
            itemId: line.item_id,
            warehouseId: r.c.data.from_warehouse_id,
            locationId: p.location_id,
            lotId: p.tracking_id,
            statusId: p.stock_status_id,
            baseQty: p.base_qty,
            date,
            source,
            actorId,
          });
          await receiveStock(tx, {
            itemId: line.item_id,
            warehouseId: transitId,
            locationId: null,
            lotNo: p.tracking_no,
            expiry: p.expiry_date,
            baseQty: p.base_qty,
            value: out.cost,
            statusId: p.stock_status_id,
            date,
            source,
            actorId,
          });
        }
      }
      await audit(tx, id, "UPDATE", "send", actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type StockTransferListRow = {
  id: number;
  transferNo: string;
  transferDate: string;
  status: StockTransferStatus;
  fromLabel: string;
  fromName: string;
  toLabel: string;
  toName: string;
  lines: number;
  qty: number;
  receivedQty: number;
};

/** Transfers from or to the warehouses in `scope` (null: every one), filtered in the database (OD-9). */
export async function listStockTransfers(scope: number[] | null): Promise<StockTransferListRow[]> {
  const rows = await prisma.logStockTransfer.findMany({
    where: scope === null ? {} : { OR: [{ from_warehouse_id: { in: scope } }, { to_warehouse_id: { in: scope } }] },
    orderBy: [{ transfer_date: "desc" }, { id: "desc" }],
    include: { from_warehouse: true, to_warehouse: true, lines: { select: { base_qty: true, received_qty: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    transferNo: r.transfer_no,
    transferDate: isoDay(r.transfer_date),
    status: r.status as StockTransferStatus,
    fromLabel: r.from_warehouse.warehouse_label,
    fromName: r.from_warehouse.warehouse_name,
    toLabel: r.to_warehouse.warehouse_label,
    toName: r.to_warehouse.warehouse_name,
    lines: r.lines.length,
    qty: r.lines.reduce((s, l) => s + l.base_qty.toNumber(), 0),
    receivedQty: r.lines.reduce((s, l) => s + l.received_qty.toNumber(), 0),
  }));
}

export type StockTransferView = {
  id: number;
  transferNo: string;
  status: StockTransferStatus;
  header: StockTransferHeaderInput;
  transit: { id: number; label: string; name: string } | null;
  lines: (StockTransferLineInput & {
    id: number;
    receivedQty: number;
    pickedLots: {
      id: number;
      lotId: number;
      locationId: number | null;
      locationLabel: string | null;
      statusId: number;
      statusName: string;
      lotNo: string;
      expiry: string | null;
      qty: number;
      receivedQty: number;
    }[];
  })[];
  cancelReason: string | null;
};

export async function getStockTransfer(id: number): Promise<StockTransferView | null> {
  const n = await prisma.logStockTransfer.findUnique({ where: { id }, include: WITH_PICKS });
  if (!n) return null;
  const input = asInput(n);
  const picks = n.lines.flatMap((l) => l.trackings);
  const [locations, statuses, transit] = await Promise.all([
    locationLabelsByIds(picks.flatMap((p) => (p.location_id ? [p.location_id] : []))),
    prisma.sysStockStatus.findMany({ select: { id: true, status_name: true } }),
    n.transit_warehouse_id ? prisma.refWarehouse.findUnique({ where: { id: n.transit_warehouse_id } }) : null,
  ]);
  const statusName = new Map(statuses.map((s) => [s.id, s.status_name]));
  return {
    id: n.id,
    transferNo: n.transfer_no,
    status: n.status as StockTransferStatus,
    header: input.header,
    transit: transit ? { id: transit.id, label: transit.warehouse_label, name: transit.warehouse_name } : null,
    lines: input.lines.map((l, i) => ({
      ...l,
      id: n.lines[i].id,
      receivedQty: n.lines[i].received_qty.toNumber(),
      pickedLots: n.lines[i].trackings.map((p) => ({
        id: p.id,
        lotId: p.tracking_id,
        locationId: p.location_id,
        locationLabel: p.location_id ? (locations.get(p.location_id) ?? null) : null,
        statusId: p.stock_status_id,
        statusName: statusName.get(p.stock_status_id) ?? "",
        lotNo: p.tracking_no,
        expiry: p.expiry_date ? isoDay(p.expiry_date) : null,
        qty: p.base_qty.toNumber(),
        receivedQty: p.received_qty.toNumber(),
      })),
    })),
    cancelReason: n.cancel_reason,
  };
}

/** What a stored transfer's form must keep readable, whatever its state now. */
export function stockTransferCurrent(v: StockTransferView) {
  return {
    fromId: Number(v.header.from_warehouse_id),
    toId: Number(v.header.to_warehouse_id),
    itemIds: v.lines.map((l) => Number(l.item_id)),
    lotIds: v.lines.flatMap((l) => l.pickedLots.map((p) => p.lotId)),
  };
}

/** A transfer's two warehouses, for the actions' access check (OD-9). */
export async function stockTransferWarehouses(id: number): Promise<{ fromId: number; toId: number } | null> {
  const r = await prisma.logStockTransfer.findUnique({ where: { id }, select: { from_warehouse_id: true, to_warehouse_id: true } });
  return r ? { fromId: r.from_warehouse_id, toId: r.to_warehouse_id } : null;
}

/** Transfer Kirim numbers by id, for the audit panel. */
export async function stockTransferNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logStockTransfer.findMany({ where: { id: { in: ids } }, select: { id: true, transfer_no: true } });
  return new Map(rows.map((r) => [r.id, r.transfer_no]));
}

/** Draft transfers sending from a warehouse, for the Lokasi Gudang master's first-location rule (P267). */
export async function stockTransferLocationUse(warehouseId: number): Promise<{ drafts: number }> {
  return { drafts: await prisma.logStockTransfer.count({ where: { from_warehouse_id: warehouseId, status: "Draft" } }) };
}

// ------------------------------------------- for Transfer Terima (§3.2)

export type TransferForReceipt = {
  id: number;
  transferNo: string;
  transferDate: string;
  status: StockTransferStatus;
  fromId: number;
  fromLabel: string;
  fromName: string;
  toId: number;
  toLabel: string;
  toName: string;
  transitId: number | null;
  lines: {
    id: number;
    lineNo: number;
    itemId: number;
    uomId: number;
    qty: number;
    receivedQty: number;
    trackings: { id: number; trackingId: number; trackingNo: string; expiry: string | null; statusId: number; qty: number; receivedQty: number }[];
  }[];
};

/**
 * Transfers a Transfer Terima may receive, or reads: by ids, or every one in
 * transit whose destination is in `scope` (null: every one). With `lock`, the
 * rows are locked for the receipt's posting.
 */
export async function transfersForReceipt(
  db: Db,
  q: { ids?: number[]; inTransitTo?: number[] | null },
  lock = false
): Promise<TransferForReceipt[]> {
  if (lock && q.ids?.length) {
    await db.$queryRaw`SELECT "id" FROM "log_stock_transfer" WHERE "id" = ANY(${q.ids}::int[]) FOR UPDATE`;
  }
  const where: Prisma.LogStockTransferWhereInput = q.ids
    ? { id: { in: q.ids } }
    : { status: "InTransit", ...(q.inTransitTo === null || q.inTransitTo === undefined ? {} : { to_warehouse_id: { in: q.inTransitTo } }) };
  const rows = await db.logStockTransfer.findMany({
    where,
    orderBy: [{ transfer_date: "asc" }, { id: "asc" }],
    include: { from_warehouse: true, to_warehouse: true, ...WITH_PICKS },
  });
  return rows.map((r) => ({
    id: r.id,
    transferNo: r.transfer_no,
    transferDate: isoDay(r.transfer_date),
    status: r.status as StockTransferStatus,
    fromId: r.from_warehouse_id,
    fromLabel: r.from_warehouse.warehouse_label,
    fromName: r.from_warehouse.warehouse_name,
    toId: r.to_warehouse_id,
    toLabel: r.to_warehouse.warehouse_label,
    toName: r.to_warehouse.warehouse_name,
    transitId: r.transit_warehouse_id,
    lines: r.lines.map((l) => ({
      id: l.id,
      lineNo: l.line_no,
      itemId: l.item_id,
      uomId: l.uom_id,
      qty: l.base_qty.toNumber(),
      receivedQty: l.received_qty.toNumber(),
      trackings: l.trackings.map((t) => ({
        id: t.id,
        trackingId: t.tracking_id,
        trackingNo: t.tracking_no,
        expiry: t.expiry_date ? isoDay(t.expiry_date) : null,
        statusId: t.stock_status_id,
        qty: t.base_qty.toNumber(),
        receivedQty: t.received_qty.toNumber(),
      })),
    })),
  }));
}

/**
 * What a posted Transfer Terima brought in, per Kirim tracking row: written on
 * the rows and their lines, and the transfer becomes Diterima once every line
 * is received in full. Called inside the receipt's posting, the transfer locked.
 */
export async function recordStockTransferReceived(
  tx: Prisma.TransactionClient,
  transferId: number,
  received: { trackingId: number; baseQty: number }[],
  actorId: number
): Promise<{ closed: boolean }> {
  for (const r of received) {
    const row = await tx.logStockTransferTracking.findUniqueOrThrow({ where: { id: r.trackingId }, select: { received_qty: true, base_qty: true, stock_transfer_line_id: true, line: { select: { stock_transfer_id: true } } } });
    if (row.line.stock_transfer_id !== transferId) throw new InventoryRefusal("Lot tidak termasuk Transfer Kirim ini.");
    const next = units(row.received_qty.toNumber()) + units(r.baseQty);
    if (next > units(row.base_qty.toNumber())) throw new InventoryRefusal("Jumlah diterima melebihi yang dikirim.");
    await tx.logStockTransferTracking.update({ where: { id: r.trackingId }, data: { received_qty: fromUnits(next) } });
    await tx.logStockTransferLine.update({ where: { id: row.stock_transfer_line_id }, data: { received_qty: { increment: r.baseQty } } });
  }
  const lines = await tx.logStockTransferLine.findMany({ where: { stock_transfer_id: transferId }, select: { base_qty: true, received_qty: true } });
  const full = lines.every((l) => l.received_qty.gte(l.base_qty));
  if (full) {
    const done = await tx.logStockTransfer.updateMany({ where: { id: transferId, status: "InTransit" }, data: { status: "Received", updated_by: actorId } });
    if (done.count === 1) await audit(tx, transferId, "UPDATE", "received", actorId);
  }
  return { closed: full };
}
