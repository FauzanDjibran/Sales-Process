import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatNumber } from "@/lib/format";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate, holdPostingPeriod, PeriodShut } from "./fiscal";
import { InventoryRefusal, issueStock, locationLabelsByIds, receiveStock, warehouseLocationOptions, type WarehouseLocationOption } from "./inventory";
import { recordStockTransferReceived, transfersForReceipt, type TransferForReceipt } from "./stock-transfer";
import {
  STOCK_TRANSFER_RECEIPT_TRANSITIONS,
  stockTransferReceiptIsEditable,
  stockTransferReceiptTransitionAllowed,
  type StockTransferReceiptAction,
  type StockTransferReceiptStatus,
} from "./stock-transfer-workflow";

/**
 * Transfer Terima (P300, `Stock-Transfer-Plan.md` §3.2): its tables are
 * `log_stock_transfer_receipt`, `_line` and `_tracking`, and nothing else names
 * them. It reads the Transfer Kirim it receives only through
 * `stock-transfer.ts` (`transfersForReceipt`, `recordStockTransferReceived`).
 *
 * One receipt takes one Transfer Kirim in transit, chosen once and locked; the
 * destination is the Kirim's. Each line is a quantity of one Kirim line, and
 * its lots are the Kirim's tracking rows — lot and status travel with the goods
 * (OD-4) — each put in a location of the destination where it keeps them. The
 * live receipts (Draft and Posted) never take more of a tracking row than was
 * sent; the rest stays in transit until a later receipt or, for what was lost
 * on the way, stock opname (OD-7). Not dated before the Kirim.
 *
 * **Terima**, in one transaction with the period held and the Kirim locked:
 * each row is issued from the Gudang Transit and received into the destination
 * at the value just released, so the pool ends where it started (OD-6); no
 * journal. The Kirim records what came in and becomes Diterima once full.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type TransferReceiptHeaderInput = { stock_transfer_id: number | null; receipt_date: string; note: string };

/** One Kirim tracking row received into a destination location. */
export type TransferReceiptPickInput = { transfer_tracking_id: number; location_id: number | null; qty: number | string };

export type TransferReceiptLineInput = { transfer_line_id: number; qty: number | string; note: string; picks?: TransferReceiptPickInput[] };

export type TransferReceiptResult = { ok: true; id: number; receiptNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);
const parseQty = (v: unknown) => Number(String(v ?? "").replace(",", "."));

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
    if (e instanceof InventoryRefusal) return { ok: false, errors: { _form: `Belum bisa diterima: ${e.message}` } };
    throw e;
  }
}

// ---------------------------------------------------------------- sources

export type ReceiptSourceTracking = TransferForReceipt["lines"][number]["trackings"][number] & {
  statusName: string;
  /** What live receipts other than this one already take of it. */
  held: number;
  /** Still free to receive here. */
  room: number;
};

export type ReceiptSource = Omit<TransferForReceipt, "lines"> & {
  lines: (Omit<TransferForReceipt["lines"][number], "trackings"> & {
    itemLabel: string;
    itemName: string;
    uomLabel: string;
    held: number;
    room: number;
    trackings: ReceiptSourceTracking[];
  })[];
  /** The destination's locations, or null when it keeps none. */
  locations: WarehouseLocationOption[] | null;
};

/** What live receipts other than `selfId` take of each Kirim tracking row. */
async function heldByOthers(db: Db, trackingIds: number[], selfId: number | null): Promise<Map<number, number>> {
  if (!trackingIds.length) return new Map();
  const rows = await db.logStockTransferReceiptTracking.groupBy({
    by: ["stock_transfer_tracking_id"],
    where: {
      stock_transfer_tracking_id: { in: trackingIds },
      line: { receipt: { status: { in: ["Draft", "Posted"] }, ...(selfId ? { id: { not: selfId } } : {}) } },
    },
    _sum: { base_qty: true },
  });
  return new Map(rows.map((r) => [r.stock_transfer_tracking_id, r._sum.base_qty?.toNumber() ?? 0]));
}

/**
 * The Transfer Kirim sources a receipt may take: by ids (a stored receipt's),
 * or every one in transit to the warehouses in `scope`. Each with its items
 * and, per line and tracking row, what other live receipts hold and the room
 * left.
 */
export async function transferReceiptSources(
  db: Db,
  q: { ids?: number[]; scope?: number[] | null },
  selfId: number | null,
  lock = false
): Promise<ReceiptSource[]> {
  const transfers = await transfersForReceipt(db, q.ids ? { ids: q.ids } : { inTransitTo: q.scope ?? null }, lock);
  const trackingIds = transfers.flatMap((t) => t.lines.flatMap((l) => l.trackings.map((x) => x.id)));
  const itemIds = [...new Set(transfers.flatMap((t) => t.lines.map((l) => l.itemId)))];
  const [held, items, statuses, locations] = await Promise.all([
    heldByOthers(db, trackingIds, selfId),
    db.mItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, item_label: true, item_name: true, base_uom: { select: { uom_label: true } } } }),
    db.sysStockStatus.findMany({ select: { id: true, status_name: true } }),
    warehouseLocationOptions([...new Set(transfers.map((t) => t.toId))], db),
  ]);
  const itemBy = new Map(items.map((i) => [i.id, i]));
  const statusName = new Map(statuses.map((s) => [s.id, s.status_name]));
  return transfers.map((t) => {
    const own = locations.get(t.toId) ?? [];
    return {
      ...t,
      locations: own.length ? own : null,
      lines: t.lines.map((l) => {
        const trackings = l.trackings.map((x) => {
          const h = held.get(x.id) ?? 0;
          return { ...x, statusName: statusName.get(x.statusId) ?? "", held: h, room: fromUnits(Math.max(0, units(x.qty) - units(h))) };
        });
        const item = itemBy.get(l.itemId);
        return {
          ...l,
          itemLabel: item?.item_label ?? "",
          itemName: item?.item_name ?? "",
          uomLabel: item?.base_uom.uom_label ?? "",
          held: trackings.reduce((s, x) => s + x.held, 0),
          room: fromUnits(trackings.reduce((s, x) => s + units(x.room), 0)),
          trackings,
        };
      }),
    };
  });
}

// ------------------------------------------------------------- validation

type CheckedPick = { pick_no: number; stock_transfer_tracking_id: number; tracking_id: number; stock_status_id: number; location_id: number | null; tracking_no: string; expiry_date: Date | null; base_qty: number };
type CheckedLine = { line_no: number; stock_transfer_line_id: number; item_id: number; uom_id: number; base_qty: number; note: string | null; picks: CheckedPick[] };
type Checked = {
  data: { stock_transfer_id: number; to_warehouse_id: number; receipt_date: Date; note: string | null };
  source: ReceiptSource;
  lines: CheckedLine[];
};

/**
 * Every rule a Transfer Terima must satisfy to be saved — and, run again inside
 * the posting with `forPosting` and the Kirim locked, to be posted: every line
 * then split over its lots in full, a location for each where the destination
 * keeps them. Which destination the user may receive into is the action's
 * question (OD-9).
 */
export async function checkTransferReceipt(
  db: Db,
  header: TransferReceiptHeaderInput,
  lines: TransferReceiptLineInput[],
  selfId: number | null,
  forPosting = false,
  lock = false
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const transferId = Number(header.stock_transfer_id) || null;
  if (!transferId) return { ok: false, errors: { stock_transfer_id: "Pilih Transfer Kirim." } };
  const [source] = await transferReceiptSources(db, { ids: [transferId] }, selfId, lock);
  if (!source) return { ok: false, errors: { stock_transfer_id: "Transfer Kirim tidak ditemukan." } };
  if (source.status !== "InTransit") {
    return { ok: false, errors: { stock_transfer_id: `${source.transferNo} tidak sedang dalam perjalanan.` } };
  }
  if (!source.transitId) return { ok: false, errors: { stock_transfer_id: `${source.transferNo} tidak mencatat Gudang Transit.` } };

  const date = String(header.receipt_date ?? "").trim();
  if (!DAY.test(date)) errors.receipt_date = "Tanggal Terima wajib diisi.";
  else if (date < source.transferDate) errors.receipt_date = "Tidak boleh sebelum Tanggal Kirim.";

  const locations = new Map((source.locations ?? []).map((l) => [l.id, l]));
  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu barang.";
  const out: CheckedLine[] = [];
  const seenLines = new Set<number>();
  for (const [i, l] of raw.entries()) {
    const line = source.lines.find((x) => x.id === Number(l.transfer_line_id));
    if (!line) {
      errors[lineKey(i, "qty")] = "Baris tidak termasuk Transfer Kirim ini.";
      continue;
    }
    if (seenLines.has(line.id)) {
      errors[lineKey(i, "qty")] = `${line.itemLabel} dipilih lebih dari sekali.`;
      continue;
    }
    seenLines.add(line.id);
    const qty = parseQty(l.qty);
    if (!Number.isFinite(qty) || !(qty > 0)) {
      errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
      continue;
    }
    if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
      continue;
    }
    if (units(qty) > units(line.room)) {
      errors[lineKey(i, "qty")] = `Melebihi sisa yang belum diterima (${qtyText(line.room)} ${line.uomLabel}).`;
      continue;
    }
    // Lots: each Kirim tracking row of this line, into a location (once each), within what is left of it.
    const picks: CheckedPick[] = [];
    const taken = new Map<number, number>();
    const seen = new Set<string>();
    let total = 0;
    let bad: string | null = null;
    for (const p of Array.isArray(l.picks) ? l.picks : []) {
      const t = line.trackings.find((x) => x.id === Number(p.transfer_tracking_id));
      if (!t) {
        bad = `Lot tidak termasuk baris ${line.itemLabel}. Pilih ulang lotnya.`;
        break;
      }
      const pq = parseQty(p.qty);
      if (!Number.isFinite(pq) || !(pq > 0)) {
        bad = `Isi jumlah lot ${t.trackingNo} lebih dari 0.`;
        break;
      }
      const locationId = Number(p.location_id) || null;
      if (source.locations) {
        const loc = locationId ? locations.get(locationId) : undefined;
        if (!locationId) {
          if (forPosting) {
            bad = `Lot ${t.trackingNo}: pilih lokasi di gudang ${source.toLabel}.`;
            break;
          }
        } else if (!loc) {
          bad = `Lokasi tidak ada di gudang ${source.toLabel}.`;
          break;
        } else if (!loc.active && forPosting) {
          bad = `Lokasi ${loc.label} nonaktif.`;
          break;
        }
      } else if (locationId) {
        bad = `Gudang ${source.toLabel} tidak memakai lokasi.`;
        break;
      }
      const key = `${t.id}:${locationId ?? 0}`;
      if (seen.has(key)) {
        bad = `Lot ${t.trackingNo} dipilih lebih dari sekali di lokasi yang sama.`;
        break;
      }
      seen.add(key);
      const sum = (taken.get(t.id) ?? 0) + units(pq);
      if (sum > units(t.room)) {
        bad = `Lot ${t.trackingNo}: melebihi sisa yang belum diterima (${qtyText(t.room)} ${line.uomLabel}).`;
        break;
      }
      taken.set(t.id, sum);
      total += units(pq);
      picks.push({
        pick_no: picks.length + 1,
        stock_transfer_tracking_id: t.id,
        tracking_id: t.trackingId,
        stock_status_id: t.statusId,
        location_id: locationId,
        tracking_no: t.trackingNo,
        expiry_date: t.expiry ? asDate(t.expiry) : null,
        base_qty: fromUnits(units(pq)),
      });
    }
    if (!bad && total > units(qty)) bad = `Lot yang dibagi (${qtyText(fromUnits(total))}) melebihi Qty baris (${qtyText(qty)} ${line.uomLabel}).`;
    if (!bad && forPosting && total !== units(qty)) bad = `${line.itemLabel}: lot baru ${qtyText(fromUnits(total))} dari ${qtyText(qty)} ${line.uomLabel}. Atur lot sampai penuh.`;
    if (bad) {
      errors[lineKey(i, "picks")] = bad;
      continue;
    }
    out.push({ line_no: out.length + 1, stock_transfer_line_id: line.id, item_id: line.itemId, uom_id: line.uomId, base_qty: fromUnits(units(qty)), note: text(l.note), picks });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, c: { data: { stock_transfer_id: source.id, to_warehouse_id: source.toId, receipt_date: asDate(date), note: text(header.note) }, source, lines: out } };
}

// ------------------------------------------------------------------ writes

async function nextReceiptNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("TST", date, async (series) => {
    const row = await db.logStockTransferReceipt.findFirst({ where: { receipt_no: { startsWith: series } }, orderBy: { receipt_no: "desc" }, select: { receipt_no: true } });
    return row?.receipt_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "log_stock_transfer_receipt", row_id: id, action, event, by } });
}

const rowData = (l: CheckedLine) => {
  const { picks, ...line } = l;
  return { ...line, trackings: { create: picks } };
};

export async function createTransferReceipt(header: TransferReceiptHeaderInput, lines: TransferReceiptLineInput[], actorId: number): Promise<TransferReceiptResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      // Drafts hold what they take: checked with the Kirim locked, as at posting.
      const r = await checkTransferReceipt(tx, header, lines, null, false, true);
      if (!r.ok) throw new Refused(r.errors);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('log_stock_transfer_receipt_no'))`;
      const row = await tx.logStockTransferReceipt.create({
        data: { ...r.c.data, receipt_no: await nextReceiptNo(tx, r.c.data.receipt_date), created_by: actorId, lines: { create: r.c.lines.map(rowData) } },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, receiptNo: made.receipt_no };
  });
}

export async function updateTransferReceipt(id: number, header: TransferReceiptHeaderInput, lines: TransferReceiptLineInput[], actorId: number): Promise<TransferReceiptResult> {
  const current = await prisma.logStockTransferReceipt.findUnique({ where: { id }, select: { status: true, receipt_no: true, stock_transfer_id: true } });
  if (!current) return { ok: false, errors: { _form: "Transfer Terima tidak ditemukan." } };
  if (!stockTransferReceiptIsEditable(current.status as StockTransferReceiptStatus)) {
    return { ok: false, errors: { _form: "Transfer Terima yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      // The Kirim is chosen once and locked.
      const r = await checkTransferReceipt(tx, { ...header, stock_transfer_id: current.stock_transfer_id }, lines, id, false, true);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.logStockTransferReceipt.updateMany({ where: { id, status: "Draft" }, data: { receipt_date: r.c.data.receipt_date, note: r.c.data.note, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Transfer Terima berubah saat diproses. Muat ulang halaman." });
      await tx.logStockTransferReceiptTracking.deleteMany({ where: { line: { receipt_id: id } } });
      await tx.logStockTransferReceiptLine.deleteMany({ where: { receipt_id: id } });
      for (const l of r.c.lines) await tx.logStockTransferReceiptLine.create({ data: { ...rowData(l), receipt_id: id } });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, receiptNo: current.receipt_no };
  });
}

const WITH_PICKS = { lines: { include: { trackings: { orderBy: { pick_no: "asc" as const } } }, orderBy: { line_no: "asc" as const } } };
type StoredReceipt = Prisma.LogStockTransferReceiptGetPayload<{ include: typeof WITH_PICKS }>;

function asInput(n: StoredReceipt): { header: TransferReceiptHeaderInput; lines: TransferReceiptLineInput[] } {
  return {
    header: { stock_transfer_id: n.stock_transfer_id, receipt_date: isoDay(n.receipt_date), note: n.note ?? "" },
    lines: n.lines.map((l) => ({
      transfer_line_id: l.stock_transfer_line_id,
      qty: l.base_qty.toNumber(),
      note: l.note ?? "",
      picks: l.trackings.map((p) => ({ transfer_tracking_id: p.stock_transfer_tracking_id, location_id: p.location_id, qty: p.base_qty.toNumber() })),
    })),
  };
}

export type TransferReceiptTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * **Terima**, in one transaction: the period held, the Kirim locked, the
 * stored receipt rechecked; each row out of the Gudang Transit and into the
 * destination at the value released; the Kirim told what came in.
 * **Batalkan** (Draft only) asks for a reason, giving back what it held.
 */
export async function transitionTransferReceipt(id: number, action: StockTransferReceiptAction, actorId: number, reason?: string): Promise<TransferReceiptTransitionResult> {
  const receipt = await prisma.logStockTransferReceipt.findUnique({ where: { id }, include: WITH_PICKS });
  if (!receipt) return { ok: false, errors: { _form: "Transfer Terima tidak ditemukan." } };
  const t = STOCK_TRANSFER_RECEIPT_TRANSITIONS[action];
  if (!t || !stockTransferReceiptTransitionAllowed(action, receipt.status as StockTransferReceiptStatus)) {
    return { ok: false, errors: { _form: `Transfer Terima berstatus ini tidak dapat di-${(t?.label ?? action).toLowerCase()}.` } };
  }
  const moved = "Transfer Terima berubah saat diproses. Muat ulang halaman.";

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.logStockTransferReceipt.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const day = isoDay(receipt.receipt_date);
  const period = await checkTransactionDate(day);
  if (!period.ok) return { ok: false, errors: { _form: period.message } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, day);
      const input = asInput(receipt);
      const r = await checkTransferReceipt(tx, input.header, input.lines, id, true, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
        throw new Refused({ _form: `Belum bisa diterima: ${first}` });
      }
      const done = await tx.logStockTransferReceipt.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const type = await tx.sysDocType.findFirst({ where: { doc_table: "log_stock_transfer_receipt" }, select: { id: true } });
      if (!type) throw new Error("Jenis dokumen log_stock_transfer_receipt belum terdaftar. Jalankan db:seed.");
      const source = { docTypeId: type.id, docId: id, no: receipt.receipt_no };
      const date = r.c.data.receipt_date;
      const transitId = r.c.source.transitId!;
      const received: { trackingId: number; baseQty: number }[] = [];
      for (const line of r.c.lines) {
        for (const p of line.picks) {
          // Out of the transit at the moving average, into the destination at that same value (OD-6).
          const out = await issueStock(tx, {
            itemId: line.item_id,
            warehouseId: transitId,
            locationId: null,
            lotId: p.tracking_id,
            statusId: p.stock_status_id,
            baseQty: p.base_qty,
            date,
            source,
            actorId,
          });
          await receiveStock(tx, {
            itemId: line.item_id,
            warehouseId: r.c.data.to_warehouse_id,
            locationId: p.location_id,
            lotNo: p.tracking_no,
            expiry: p.expiry_date,
            baseQty: p.base_qty,
            value: out.cost,
            statusId: p.stock_status_id,
            date,
            source,
            actorId,
          });
          received.push({ trackingId: p.stock_transfer_tracking_id, baseQty: p.base_qty });
        }
      }
      await recordStockTransferReceived(tx, r.c.source.id, received, actorId);
      await audit(tx, id, "UPDATE", "post", actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type TransferReceiptListRow = {
  id: number;
  receiptNo: string;
  receiptDate: string;
  status: StockTransferReceiptStatus;
  transferId: number;
  transferNo: string;
  fromLabel: string;
  fromName: string;
  toLabel: string;
  toName: string;
  lines: number;
  qty: number;
};

/** Receipts into the warehouses in `scope` (null: every one), filtered in the database (OD-9). */
export async function listTransferReceipts(scope: number[] | null): Promise<TransferReceiptListRow[]> {
  const rows = await prisma.logStockTransferReceipt.findMany({
    where: scope === null ? {} : { to_warehouse_id: { in: scope } },
    orderBy: [{ receipt_date: "desc" }, { id: "desc" }],
    include: { to_warehouse: true, lines: { select: { base_qty: true } } },
  });
  const sources = new Map(
    (await transfersForReceipt(prisma, { ids: [...new Set(rows.map((r) => r.stock_transfer_id))] })).map((t) => [t.id, t])
  );
  return rows.map((r) => {
    const s = sources.get(r.stock_transfer_id);
    return {
      id: r.id,
      receiptNo: r.receipt_no,
      receiptDate: isoDay(r.receipt_date),
      status: r.status as StockTransferReceiptStatus,
      transferId: r.stock_transfer_id,
      transferNo: s?.transferNo ?? "",
      fromLabel: s?.fromLabel ?? "",
      fromName: s?.fromName ?? "",
      toLabel: r.to_warehouse.warehouse_label,
      toName: r.to_warehouse.warehouse_name,
      lines: r.lines.length,
      qty: r.lines.reduce((sum, l) => sum + l.base_qty.toNumber(), 0),
    };
  });
}

export type TransferReceiptView = {
  id: number;
  receiptNo: string;
  status: StockTransferReceiptStatus;
  header: TransferReceiptHeaderInput;
  lines: (TransferReceiptLineInput & {
    id: number;
    pickedLots: { transferTrackingId: number; lotNo: string; expiry: string | null; statusId: number; locationId: number | null; locationLabel: string | null; qty: number }[];
  })[];
  cancelReason: string | null;
};

export async function getTransferReceipt(id: number): Promise<TransferReceiptView | null> {
  const n = await prisma.logStockTransferReceipt.findUnique({ where: { id }, include: WITH_PICKS });
  if (!n) return null;
  const input = asInput(n);
  const locations = await locationLabelsByIds(n.lines.flatMap((l) => l.trackings.flatMap((p) => (p.location_id ? [p.location_id] : []))));
  return {
    id: n.id,
    receiptNo: n.receipt_no,
    status: n.status as StockTransferReceiptStatus,
    header: input.header,
    lines: input.lines.map((l, i) => ({
      ...l,
      id: n.lines[i].id,
      pickedLots: n.lines[i].trackings.map((p) => ({
        transferTrackingId: p.stock_transfer_tracking_id,
        lotNo: p.tracking_no,
        expiry: p.expiry_date ? isoDay(p.expiry_date) : null,
        statusId: p.stock_status_id,
        locationId: p.location_id,
        locationLabel: p.location_id ? (locations.get(p.location_id) ?? null) : null,
        qty: p.base_qty.toNumber(),
      })),
    })),
    cancelReason: n.cancel_reason,
  };
}

/** A Transfer Kirim's destination, for the actions' access check when a receipt is made (OD-9). */
export async function transferDestinationOf(transferId: number | null): Promise<number | null> {
  if (!transferId) return null;
  const [t] = await transfersForReceipt(prisma, { ids: [transferId] });
  return t?.toId ?? null;
}

/** A receipt's destination, for the actions' access check (OD-9). */
export async function transferReceiptWarehouse(id: number): Promise<number | null> {
  return (await prisma.logStockTransferReceipt.findUnique({ where: { id }, select: { to_warehouse_id: true } }))?.to_warehouse_id ?? null;
}

/** The receipts of one Transfer Kirim, for its page's related documents. */
export async function receiptsOfTransfer(transferId: number): Promise<{ id: number; receiptNo: string; receiptDate: string; status: StockTransferReceiptStatus; qty: number }[]> {
  const rows = await prisma.logStockTransferReceipt.findMany({
    where: { stock_transfer_id: transferId },
    orderBy: [{ receipt_date: "asc" }, { id: "asc" }],
    include: { lines: { select: { base_qty: true } } },
  });
  return rows.map((r) => ({ id: r.id, receiptNo: r.receipt_no, receiptDate: isoDay(r.receipt_date), status: r.status as StockTransferReceiptStatus, qty: r.lines.reduce((s, l) => s + l.base_qty.toNumber(), 0) }));
}

/** Transfer Terima numbers by id, for the audit panel. */
export async function transferReceiptNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logStockTransferReceipt.findMany({ where: { id: { in: ids } }, select: { id: true, receipt_no: true } });
  return new Map(rows.map((r) => [r.id, r.receipt_no]));
}

/** Draft receipts into a warehouse and the locations any names, for the Lokasi Gudang master (P267). */
export async function transferReceiptLocationUse(warehouseId: number, locationIds: number[]): Promise<{ drafts: number; named: Set<number> }> {
  const [drafts, named] = await Promise.all([
    prisma.logStockTransferReceipt.count({ where: { to_warehouse_id: warehouseId, status: "Draft" } }),
    locationIds.length
      ? prisma.logStockTransferReceiptTracking.findMany({ where: { location_id: { in: locationIds } }, distinct: ["location_id"], select: { location_id: true } })
      : [],
  ]);
  return { drafts, named: new Set(named.flatMap((r) => (r.location_id ? [r.location_id] : []))) };
}

/** The Transfer Kirim in transit to the warehouses in `scope`, for the new receipt's picker. */
export async function receiptSourcePicker(scope: number[] | null): Promise<{ id: number; label: string; name: string; active: boolean }[]> {
  const rows = await transfersForReceipt(prisma, { inTransitTo: scope });
  return rows.map((t) => ({ id: t.id, label: t.transferNo, name: `${t.fromLabel} → ${t.toLabel} · ${t.transferDate.split("-").reverse().join("/")}`, active: true }));
}

/** One Transfer Kirim as a receipt reads it; `selfId` a stored receipt whose own holdings are left out. */
export async function receiptSource(transferId: number, selfId: number | null = null): Promise<ReceiptSource | null> {
  const [s] = await transferReceiptSources(prisma, { ids: [transferId] }, selfId);
  return s ?? null;
}
