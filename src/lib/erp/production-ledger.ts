import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { carriedSupplier, inputsPartai, shareByWeight, shareQty, type JobRef, type PartaiRef } from "./production-execution";
import { freeNumber, nextDailyNumber } from "./production-number";

/**
 * The production ledger (P150 E2, E3; P157; Walet M112, M127, M128) — the book
 * of what is inside production.
 *
 * **The lot is the stock lot.** Every lot has one row in the global register
 * `log_stock_tracking` (M128): goods issued from stock enter production under
 * the same lot, and a transformation registers a new lot for its output, the
 * execution as its source and the one supplier behind its inputs carried.
 *
 * A **bucket** (`prd_balance`) is one lot, carried by one **Job** (or none),
 * at one workstation — or **in transit** to it (M113, M127) — holding
 * quantity Q in the item's base unit and value V in whole rupiah; Σ V is WIP.
 * It names its **Partai** (M112): the cost identity, never split or merged.
 * Buckets are never pooled with one another and do not follow the stock
 * moving average (G12). Every movement is a row of `prd_ledger`, written in
 * the same transaction as the bucket it changes, with the balances after it;
 * one ledger number `MP/YYYY/MM/NNNN` per posting (P110).
 *
 * - **Taking** q from a bucket releases round(V × q ÷ Q), or V whole when q
 *   empties it, so a bucket always ends at 0 / 0 (M11, as P114's pools).
 * - **Producing** (an execution) takes every input, adds the execution's
 *   standard conversion (P155 M92), shares the total over the outputs by
 *   Bobot Biaya, registers each output lot and fills its bucket, and writes
 *   the genealogy (`prd_lot_link`). Cost in = cost out (G3). Its inputs belong
 *   to one Partai at most.
 * - **A Partai** (`P_<DDMMYY>_<NNNNN>`) and **a Job** (`<Kode Job>_<DDMMYY>_<NNNNN>`,
 *   M124, M126) are started by the documents that make them.
 * - **Transit** (M113): goods sent to a station wait in its transit bucket
 *   until it **receives** them (into its own bucket) or **returns** them, each
 *   sending moving exactly its own quantity and value.
 * - **Revaluing** adds a value with quantity 0 — the month-end close (M96).
 *
 * Only a Barang with Kelola Stok enters production (M8). Buckets are locked
 * `FOR UPDATE` in id order; a document that also moves stock locks the stock
 * pools first (§16 X23).
 *
 * A book: it imports only the shared kernel (and the pure execution
 * arithmetic) and is called by the documents, never the reverse (§3.1). It
 * writes no journal — the document posts WIP beside it. Its tables are named
 * only here; the lot register it shares with the stock book.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** A movement production refuses — short quantity, an unknown lot, a Partai clash. */
export class ProductionRefusal extends Error {}

export type ProductionSource = { docTypeId: number; docId: number; no: string };

type Movement = "Issued" | "Consumed" | "Produced" | "Released" | "Revalued" | "Received" | "Returned" | "Sent";

const qtyText = (d: Dec) => d.toDecimalPlaces(4).toString().replace(".", ",");
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const describe = (value: Dec, qty: Dec) => (qty.isZero() ? new D(0) : value.abs().div(qty.abs()).toDecimalPlaces(6, D.ROUND_HALF_UP));

// ------------------------------------------------------------- masters

async function productionItem(tx: Tx, itemId: number) {
  const item = await tx.mItem.findUnique({
    where: { id: itemId },
    select: { item_label: true, item_type: true, track_stock: true, has_expiry: true, base_uom_id: true },
  });
  if (!item) throw new ProductionRefusal("Barang tidak ditemukan.");
  if (item.item_type !== "Barang" || !item.track_stock) {
    throw new ProductionRefusal(`${item.item_label} tidak dikelola stok (Kelola Stok tidak aktif), jadi tidak bisa masuk produksi.`);
  }
  return item;
}

async function activeWorkstation(tx: Tx, id: number) {
  const ws = await tx.refWorkstation.findUnique({ where: { id }, select: { workstation_label: true, job_code: true, status: true } });
  if (!ws) throw new ProductionRefusal("Workstation tidak ditemukan.");
  if (ws.status !== "Active") throw new ProductionRefusal(`Workstation ${ws.workstation_label} nonaktif.`);
  return ws;
}

/** The Partai a Job belongs to, and the Job's Partai checked against the one named. */
async function jobPartai(tx: Tx, jobId: number, partaiId: number | null | undefined): Promise<number> {
  const job = await tx.prdJob.findUnique({ where: { id: jobId }, select: { job_no: true, partai_id: true } });
  if (!job) throw new ProductionRefusal("Job tidak ditemukan.");
  if (partaiId != null && partaiId !== job.partai_id) throw new ProductionRefusal(`Job ${job.job_no} bukan bagian dari Partai ini.`);
  return job.partai_id;
}

// ------------------------------------------------------------- locking

type Place = { lotId: number; partaiId: number | null; jobId: number | null; workstationId: number; inTransit: boolean };
type Bucket = Place & { id: number; itemId: number; qty: Dec; value: Dec };

type BucketRow = {
  id: number;
  lot_id: number;
  partai_id: number | null;
  job_id: number | null;
  workstation_id: number;
  in_transit: boolean;
  item_id: number;
  qty_balance: Dec;
  value_balance: Dec;
};

async function lockBucketById(tx: Tx, id: number): Promise<Bucket | null> {
  const [row] = await tx.$queryRaw<BucketRow[]>`
    SELECT "id", "lot_id", "partai_id", "job_id", "workstation_id", "in_transit", "item_id", "qty_balance", "value_balance"
      FROM "prd_balance" WHERE "id" = ${id} FOR UPDATE`;
  return row
    ? {
        id: row.id,
        lotId: row.lot_id,
        partaiId: row.partai_id,
        jobId: row.job_id,
        workstationId: row.workstation_id,
        inTransit: row.in_transit,
        itemId: row.item_id,
        qty: new D(row.qty_balance),
        value: new D(row.value_balance),
      }
    : null;
}

/**
 * The bucket of a lot · Job · workstation (· in transit), created empty if
 * missing, and locked. Its Partai is fixed when it is made; goods of another
 * Partai never share it.
 */
async function openBucket(tx: Tx, k: Place & { itemId: number; uomId: number }, actorId: number): Promise<Bucket> {
  await tx.$executeRaw`
    INSERT INTO "prd_balance" ("lot_id", "partai_id", "job_id", "workstation_id", "in_transit", "item_id", "uom_id", "qty_balance", "value_balance", "created_by", "updated_at")
    VALUES (${k.lotId}, ${k.partaiId}, ${k.jobId}, ${k.workstationId}, ${k.inTransit}, ${k.itemId}, ${k.uomId}, 0, 0, ${actorId}, now())
    ON CONFLICT ("lot_id", "job_id", "workstation_id", "in_transit") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "prd_balance"
     WHERE "lot_id" = ${k.lotId} AND "job_id" IS NOT DISTINCT FROM ${k.jobId}
       AND "workstation_id" = ${k.workstationId} AND "in_transit" = ${k.inTransit}`;
  const b = (await lockBucketById(tx, row.id))!;
  if (b.partaiId !== k.partaiId) {
    // A lot outside a Job can wait at a station before its Partai starts; once
    // there it is that Partai's (M112) — two Partai never share one bucket.
    if (b.qty.isZero() && b.partaiId == null) {
      await tx.prdBalance.update({ where: { id: b.id }, data: { partai_id: k.partaiId, updated_by: actorId } });
      b.partaiId = k.partaiId;
    } else throw new ProductionRefusal("Lot ini di workstation tersebut sudah tercatat untuk Partai lain.");
  }
  return b;
}

// ------------------------------------------------------------ positions

/** One ledger number per posting (P110): the rows a document writes share it, a line each. */
async function position(tx: Tx, date: Date, s: ProductionSource) {
  const last = await tx.prdLedger.findFirst({
    where: { source_doc_type_id: s.docTypeId, source_doc_id: s.docId },
    orderBy: { line_no: "desc" },
    select: { ledger_no: true, line_no: true },
  });
  if (last) return { ledger_no: last.ledger_no, line_no: last.line_no + 1 };
  const ledger_no = await nextDocumentNumber("MP", date, async (series) => {
    const row = await tx.prdLedger.findFirst({
      where: { ledger_no: { startsWith: series }, line_no: 1 },
      orderBy: { id: "desc" },
      select: { ledger_no: true },
    });
    return row?.ledger_no ?? null;
  });
  return { ledger_no, line_no: 1 };
}

// -------------------------------------------------------------- writing

async function write(tx: Tx, b: Bucket, m: { movement: Movement; qty: Dec; value: Dec; date: Date; source: ProductionSource; actorId: number }) {
  const qty = b.qty.add(m.qty);
  const value = b.value.add(m.value);
  if (qty.lt(0) || value.lt(0)) throw new ProductionRefusal("Saldo produksi tidak boleh negatif.");
  if (qty.isZero() && !value.isZero()) throw new ProductionRefusal("Saldo produksi yang kosong tidak boleh bernilai.");
  await tx.prdBalance.update({ where: { id: b.id }, data: { qty_balance: qty, value_balance: value, updated_by: m.actorId } });
  await tx.prdLedger.create({
    data: {
      ...(await position(tx, m.date, m.source)),
      posting_date: m.date,
      source_doc_type_id: m.source.docTypeId,
      source_doc_id: m.source.docId,
      source_no: m.source.no,
      movement: m.movement,
      bucket_id: b.id,
      lot_id: b.lotId,
      partai_id: b.partaiId,
      job_id: b.jobId,
      workstation_id: b.workstationId,
      in_transit: b.inTransit,
      item_id: b.itemId,
      qty_change: m.qty,
      qty_balance: qty,
      value_change: m.value,
      value_balance: value,
      unit_cost: describe(m.value, m.qty),
      created_by: m.actorId,
    },
  });
  b.qty = qty;
  b.value = value;
}

/** round(V × q ÷ Q), or V whole when q empties the bucket (M11). */
function release(b: Bucket, qty: Dec): Dec {
  return qty.eq(b.qty) ? b.value : b.value.mul(qty).div(b.qty).toDecimalPlaces(0, D.ROUND_HALF_UP);
}

async function takeLocked(tx: Tx, b: Bucket, qty: Dec, movement: Movement, date: Date, source: ProductionSource, actorId: number) {
  if (!qty.gt(0)) throw new ProductionRefusal("Jumlah yang diambil harus lebih dari 0.");
  if (b.qty.lt(qty)) {
    const lot = await tx.logStockTracking.findUnique({ where: { id: b.lotId }, select: { tracking_no: true, item: { select: { item_label: true } } } });
    const ws = await tx.refWorkstation.findUnique({ where: { id: b.workstationId }, select: { workstation_label: true } });
    throw new ProductionRefusal(
      `Saldo produksi ${lot?.item.item_label ?? ""} lot ${lot?.tracking_no ?? ""} di ${ws?.workstation_label ?? ""} tidak cukup: tersedia ${qtyText(b.qty)}, diminta ${qtyText(qty)}.`
    );
  }
  const value = release(b, qty);
  await write(tx, b, { movement, qty: qty.neg(), value: value.neg(), date, source, actorId });
  return value;
}

// ------------------------------------------------------- identities

/**
 * Starts a Partai (M112): the next `P_<DDMMYY>_<NNNNN>` of its day (M124),
 * carrying its Item Target — the item it is planned to become — when known.
 */
export async function startPartai(
  tx: Tx,
  s: { date: Date; targetItemId?: number | null; orderId?: number | null; customerOrder?: { id: number; no: string } | null; source: ProductionSource; actorId: number }
): Promise<PartaiRef> {
  const no = await nextDailyNumber(["P"], s.date, async (series) => {
    const row = await tx.prdPartai.findFirst({ where: { partai_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { partai_no: true } });
    return row?.partai_no ?? null;
  });
  const row = await tx.prdPartai.create({
    data: {
      partai_no: no,
      partai_date: s.date,
      target_item_id: s.targetItemId ?? null,
      order_id: s.orderId ?? null,
      source_doc_type_id: s.source.docTypeId,
      source_doc_id: s.source.docId,
      source_no: s.source.no,
      customer_order_id: s.customerOrder?.id ?? null,
      customer_order_no: s.customerOrder?.no ?? null,
      created_by: s.actorId,
    },
  });
  return { id: row.id, no: row.partai_no };
}

/**
 * Starts a Job inside a Partai (M112, M125, M126): `<Kode Job>_<DDMMYY>_<NNNNN>`,
 * the code of the workstation that makes it — one without a Kode Job makes no
 * Job. Its parents, if any, are Jobs of the same Partai.
 */
export async function startJob(
  tx: Tx,
  s: { partaiId: number; workstationId: number; parentJobIds?: number[]; date: Date; source: ProductionSource; actorId: number }
): Promise<JobRef> {
  const ws = await activeWorkstation(tx, s.workstationId);
  if (!ws.job_code) throw new ProductionRefusal(`Workstation ${ws.workstation_label} tidak membuat Job (Kode Job kosong).`);
  const parents = [...new Set(s.parentJobIds ?? [])];
  for (const id of parents) await jobPartai(tx, id, s.partaiId);
  const no = await nextDailyNumber([ws.job_code], s.date, async (series) => {
    const row = await tx.prdJob.findFirst({ where: { job_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { job_no: true } });
    return row?.job_no ?? null;
  });
  const row = await tx.prdJob.create({
    data: {
      job_no: no,
      job_date: s.date,
      partai_id: s.partaiId,
      workstation_id: s.workstationId,
      source_doc_type_id: s.source.docTypeId,
      source_doc_id: s.source.docId,
      source_no: s.source.no,
      created_by: s.actorId,
      parents: { create: parents.map((parent_job_id) => ({ parent_job_id })) },
    },
  });
  return { id: row.id, no: row.job_no };
}

/** `base`, or `base-2`, `base-3`, … — the first lot number not in the register (M124). */
export async function freeLotNo(tx: Db, base: string): Promise<string> {
  return freeNumber(base, async (no) => !!(await tx.logStockTracking.findUnique({ where: { tracking_no: no }, select: { id: true } })));
}

// --------------------------------------------------------------- entering

export type ProductionEntry = {
  /** The stock lot (`log_stock_tracking`): it keeps its number in production (M128). */
  lotId: number;
  itemId: number;
  /** The Partai the goods go to; none before the first transformation. */
  partaiId?: number | null;
  /** The Job carrying them, of that Partai. */
  jobId?: number | null;
  workstationId: number;
  /** Sent and not yet received (M113). */
  inTransit?: boolean;
  /** In the item's base unit. */
  baseQty: number | string | Dec;
  /** Whole rupiah — what the stock issue released. */
  value: number | string | Dec;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

/**
 * Places goods from stock in production at a workstation (the Logistik BSTB),
 * under the same lot (M128): its bucket for that Job and workstation, created
 * if missing, takes Q and V.
 */
export async function enterProduction(tx: Tx, e: ProductionEntry): Promise<{ bucketId: number }> {
  const qty = new D(e.baseQty);
  const value = new D(e.value);
  if (!qty.gt(0)) throw new ProductionRefusal("Jumlah yang masuk produksi harus lebih dari 0.");
  if (qty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
  if (value.lt(0) || !value.isInteger()) throw new ProductionRefusal("Nilai harus rupiah utuh, tidak negatif.");
  const item = await productionItem(tx, e.itemId);
  await activeWorkstation(tx, e.workstationId);
  const lot = await tx.logStockTracking.findUnique({ where: { id: e.lotId }, select: { item_id: true } });
  if (!lot || lot.item_id !== e.itemId) throw new ProductionRefusal(`Lot ${item.item_label} tidak ditemukan.`);
  const partaiId = e.jobId != null ? await jobPartai(tx, e.jobId, e.partaiId) : (e.partaiId ?? null);
  const bucket = await openBucket(
    tx,
    { lotId: e.lotId, partaiId, jobId: e.jobId ?? null, workstationId: e.workstationId, inTransit: !!e.inTransit, itemId: e.itemId, uomId: item.base_uom_id },
    e.actorId
  );
  await write(tx, bucket, { movement: "Issued", qty, value, date: e.date, source: e.source, actorId: e.actorId });
  return { bucketId: bucket.id };
}

export type ProductionTake = {
  bucketId: number;
  /** In the item's base unit. */
  baseQty: number | string | Dec;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

export type TakenFromProduction = {
  value: number;
  lotId: number;
  lotNo: string;
  itemId: number;
  workstationId: number;
  expiry: Date | null;
  partaiId: number | null;
  jobId: number | null;
};

/**
 * Takes goods out of production (Penerimaan Hasil Produksi, Pemusnahan): the
 * bucket releases round(V × q ÷ Q), or V whole when q empties it. Refuses
 * short quantity. Says what the goods were — the lot, which they keep in
 * stock (M128), its expiry, Partai and Job.
 */
export async function takeFromBucket(tx: Tx, t: ProductionTake): Promise<TakenFromProduction> {
  const b = await lockBucketById(tx, t.bucketId);
  if (!b) throw new ProductionRefusal("Saldo produksi tidak ditemukan. Pilih ulang.");
  const value = await takeLocked(tx, b, new D(t.baseQty), "Released", t.date, t.source, t.actorId);
  const lot = await tx.logStockTracking.findUniqueOrThrow({ where: { id: b.lotId }, select: { tracking_no: true, expiry_date: true } });
  return {
    value: value.toNumber(),
    lotId: b.lotId,
    lotNo: lot.tracking_no,
    itemId: b.itemId,
    workstationId: b.workstationId,
    expiry: lot.expiry_date,
    partaiId: b.partaiId,
    jobId: b.jobId,
  };
}

// -------------------------------------------------------------- transit

export type TransitMove = {
  /** A bucket in transit — what the sending document put there. */
  bucketId: number;
  /** In the item's base unit: exactly what that document sent of this lot. */
  baseQty: number | string | Dec;
  /** Whole rupiah: exactly the value it sent with it. */
  value: number | string | Dec;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

/**
 * Takes one sending's own quantity and value out of a transit bucket — not
 * round(V × q ÷ Q): two sendings of one lot to one station share the bucket,
 * and each leaves it with exactly what it brought, so the last leaves it 0 / 0.
 */
async function takeSent(tx: Tx, m: TransitMove, movement: Movement): Promise<Bucket> {
  const b = await lockBucketById(tx, m.bucketId);
  if (!b) throw new ProductionRefusal("Saldo dalam perjalanan tidak ditemukan.");
  if (!b.inTransit) throw new ProductionRefusal("Barang ini tidak sedang dalam perjalanan.");
  const qty = new D(m.baseQty);
  const value = new D(m.value);
  if (!qty.gt(0) || value.lt(0)) throw new ProductionRefusal("Jumlah yang diterima harus lebih dari 0.");
  if (b.qty.lt(qty) || b.value.lt(value) || (qty.eq(b.qty) && !value.eq(b.value))) {
    throw new ProductionRefusal("Saldo dalam perjalanan tidak cocok dengan pengiriman ini.");
  }
  await write(tx, b, { movement, qty: qty.neg(), value: value.neg(), date: m.date, source: m.source, actorId: m.actorId });
  return b;
}

/**
 * The workstation receives goods sent to it (M113): the sending's quantity and
 * value leave the transit bucket and enter the station's bucket of the same
 * lot, Partai and Job. No value changes; no journal.
 */
export async function receiveTransit(tx: Tx, m: TransitMove): Promise<{ bucketId: number }> {
  const from = await takeSent(tx, m, "Received");
  const uom = await tx.prdBalance.findUniqueOrThrow({ where: { id: from.id }, select: { uom_id: true } });
  const to = await openBucket(
    tx,
    { lotId: from.lotId, partaiId: from.partaiId, jobId: from.jobId, workstationId: from.workstationId, inTransit: false, itemId: from.itemId, uomId: uom.uom_id },
    m.actorId
  );
  await write(tx, to, { movement: "Received", qty: new D(m.baseQty), value: new D(m.value), date: m.date, source: m.source, actorId: m.actorId });
  return { bucketId: to.id };
}

/**
 * The workstation rejects goods sent to it (M113): the sending's quantity and
 * value leave the transit bucket, back to whoever sent them — the sending
 * document puts them there (stock, for the Logistik BSTB).
 */
export async function returnTransit(tx: Tx, m: TransitMove): Promise<void> {
  await takeSent(tx, m, "Returned");
}

// ------------------------------------------------------- handing over

export type HandOver = {
  /** The sending station's bucket — received goods, never goods in transit. */
  bucketId: number;
  toWorkstationId: number;
  /** In the item's base unit. */
  baseQty: number | string | Dec;
  /** The Partai the goods belong to from now on; omitted keeps the bucket's (the hand-over that starts one names it). */
  partaiId?: number | null;
  /** The Job carrying them from now on; omitted keeps the bucket's. */
  jobId?: number | null;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

export type HandedOver = { bucketId: number; value: number; lotId: number; itemId: number; partaiId: number | null; jobId: number | null };

/**
 * A workstation hands goods on (P167, M113): round(V × q ÷ Q) leaves its bucket
 * — V whole when q empties it — and enters the **transit** bucket of the next
 * station, under the Partai and Job it carries from now on. Nothing changes
 * value; the receiving station then receives or returns it.
 */
export async function sendToTransit(tx: Tx, h: HandOver): Promise<HandedOver> {
  const from = await lockBucketById(tx, h.bucketId);
  if (!from) throw new ProductionRefusal("Saldo produksi tidak ditemukan. Pilih ulang.");
  if (from.inTransit) throw new ProductionRefusal("Barang yang masih dalam perjalanan belum dapat diserahkan lagi.");
  if (from.workstationId === h.toWorkstationId) throw new ProductionRefusal("Workstation tujuan harus lain dari workstation pengirim.");
  await activeWorkstation(tx, h.toWorkstationId);
  const partaiId = h.partaiId === undefined ? from.partaiId : h.partaiId;
  const jobId = h.jobId === undefined ? from.jobId : h.jobId;
  if (jobId != null) await jobPartai(tx, jobId, partaiId);
  const qty = new D(h.baseQty);
  const value = await takeLocked(tx, from, qty, "Sent", h.date, h.source, h.actorId);
  const { uom_id } = await tx.prdBalance.findUniqueOrThrow({ where: { id: from.id }, select: { uom_id: true } });
  const to = await openBucket(
    tx,
    { lotId: from.lotId, partaiId, jobId, workstationId: h.toWorkstationId, inTransit: true, itemId: from.itemId, uomId: uom_id },
    h.actorId
  );
  await write(tx, to, { movement: "Sent", qty, value, date: h.date, source: h.source, actorId: h.actorId });
  return { bucketId: to.id, value: value.toNumber(), lotId: from.lotId, itemId: from.itemId, partaiId, jobId };
}

/**
 * The receiving station rejects a hand-over (M113): the sending's own quantity
 * and value leave the transit bucket and go back into the sending station's
 * bucket of the same lot, Partai and Job — a Job already made is kept.
 */
export async function returnToSender(tx: Tx, m: TransitMove & { senderId: number }): Promise<void> {
  const b = await takeSent(tx, m, "Returned");
  const { uom_id } = await tx.prdBalance.findUniqueOrThrow({ where: { id: b.id }, select: { uom_id: true } });
  const back = await openBucket(
    tx,
    { lotId: b.lotId, partaiId: b.partaiId, jobId: b.jobId, workstationId: m.senderId, inTransit: false, itemId: b.itemId, uomId: uom_id },
    m.actorId
  );
  await write(tx, back, { movement: "Returned", qty: new D(m.baseQty), value: new D(m.value), date: m.date, source: m.source, actorId: m.actorId });
}

/** Whether a lot number is already in the one register (M128): a lot a run makes is always new. */
export async function lotNumberTaken(no: string, db: Db = prisma): Promise<boolean> {
  return !!(await db.logStockTracking.findUnique({ where: { tracking_no: no }, select: { id: true } }));
}

/** The supplier behind each lot (`source_partner_id`), for the one a made lot carries (M127). */
export async function lotSupplierIds(lotIds: number[], db: Db = prisma): Promise<(number | null)[]> {
  return (await db.logStockTracking.findMany({ where: { id: { in: lotIds } }, select: { source_partner_id: true } })).map((l) => l.source_partner_id);
}

/** The Partai started for a Perintah, if any (P167: one each). */
export async function partaiOfOrder(orderId: number, db: Db = prisma): Promise<{ id: number; no: string } | null> {
  const p = await db.prdPartai.findUnique({ where: { order_id: orderId }, select: { id: true, partai_no: true } });
  return p ? { id: p.id, no: p.partai_no } : null;
}

/** Every Job of a Partai, oldest first — the parents of the Jobs a Moulding hand-over makes (M127). */
export async function jobIdsOfPartai(partaiId: number, db: Db = prisma): Promise<number[]> {
  const rows = await db.prdJob.findMany({ where: { partai_id: partaiId }, orderBy: { id: "asc" }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Partai and Job numbers by id, to show what a stored document names. */
export async function productionIdentityNumbers(ids: { partaiIds?: number[]; jobIds?: number[] }, db: Db = prisma) {
  const [partai, jobs] = await Promise.all([
    ids.partaiIds?.length ? db.prdPartai.findMany({ where: { id: { in: ids.partaiIds } }, select: { id: true, partai_no: true } }) : [],
    ids.jobIds?.length ? db.prdJob.findMany({ where: { id: { in: ids.jobIds } }, select: { id: true, job_no: true } }) : [],
  ]);
  return { partai: new Map(partai.map((p) => [p.id, p.partai_no])), jobs: new Map(jobs.map((j) => [j.id, j.job_no])) };
}

// ------------------------------------------------------------ producing

export type ProduceInput = { bucketId: number; baseQty: number | string };

export type ProduceOutput = {
  itemId: number;
  /** A lot number not yet in the register (M128); `freeLotNo` finds one. */
  lotNo: string;
  expiry: Date | null;
  baseQty: number | string;
  /** Bobot Biaya (M13); 0 carries no value. */
  weight: number;
  /** The Job carrying it, of the execution's Partai. */
  jobId?: number | null;
  /** Marked Reject (AD21): its bucket is flagged, it stays in production until taken out (O6). */
  reject?: boolean;
};

export type Production = {
  workstationId: number;
  inputs: ProduceInput[];
  outputs: ProduceOutput[];
  /** The execution's standard conversion, whole rupiah (P155 M92); 0 without a standard. */
  addedValue?: number;
  /**
   * The Partai the execution works (M114): its inputs' Partai, or — when none
   * of them has one yet — one the caller just started (the first transformation).
   */
  partaiId?: number | null;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

export type Produced = {
  /** Per input, in the order given: what it released. */
  inputs: { bucketId: number; lotId: number; itemId: number; value: number }[];
  /** Per output, in the order given: its registered lot, bucket and value. */
  outputs: { lotId: number; bucketId: number; value: number }[];
  /** Σ input value + added value = Σ output value. */
  total: number;
  partaiId: number | null;
};

/**
 * One execution, balanced (M12): takes every input, shares Σ input value plus
 * the added value over the outputs by Bobot Biaya (largest remainder),
 * registers each output lot — the execution its source, the one supplier
 * behind its inputs carried (M128) — fills its bucket at the execution's
 * workstation, and records the genealogy. Its inputs belong to one Partai at
 * most (M112). Called inside the execution's posting.
 */
export async function produce(tx: Tx, p: Production): Promise<Produced> {
  if (!p.inputs.length) throw new ProductionRefusal("Eksekusi memerlukan minimal satu input.");
  if (!p.outputs.length) throw new ProductionRefusal("Eksekusi memerlukan minimal satu output.");
  const added = p.addedValue ?? 0;
  if (!Number.isInteger(added) || added < 0) throw new ProductionRefusal("Biaya konversi harus rupiah utuh, tidak negatif.");
  const weights = p.outputs.map((o) => Number(o.weight));
  if (weights.some((w) => !(w >= 0))) throw new ProductionRefusal("Bobot Biaya tidak boleh negatif.");
  if (!(weights.reduce((a, w) => a + w, 0) > 0)) throw new ProductionRefusal("Jumlah Bobot Biaya output harus lebih dari 0.");
  await activeWorkstation(tx, p.workstationId);

  // Outputs first checked, nothing written: a refusal leaves no half posting
  // even before the transaction rolls back.
  const outItems = new Map<number, Awaited<ReturnType<typeof productionItem>>>();
  const seen = new Set<string>();
  const outs = [];
  for (const o of p.outputs) {
    const item = outItems.get(o.itemId) ?? (await productionItem(tx, o.itemId));
    outItems.set(o.itemId, item);
    const qty = new D(o.baseQty);
    if (!qty.gt(0)) throw new ProductionRefusal(`Jumlah output ${item.item_label} harus lebih dari 0.`);
    if (qty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
    const lotNo = String(o.lotNo ?? "").trim().toUpperCase();
    if (!lotNo) throw new ProductionRefusal(`Isi No. Lot output ${item.item_label}.`);
    if (seen.has(lotNo)) throw new ProductionRefusal(`Lot ${lotNo} dipakai dua kali.`);
    seen.add(lotNo);
    if (await tx.logStockTracking.findUnique({ where: { tracking_no: lotNo }, select: { id: true } })) {
      throw new ProductionRefusal(`Lot ${lotNo} sudah tercatat; lot hasil transformasi selalu baru.`);
    }
    if (item.has_expiry && !o.expiry) throw new ProductionRefusal(`${item.item_label} memiliki kadaluarsa: isi tanggal kadaluarsa lot ${lotNo}.`);
    outs.push({ ...o, lotNo, qty, item });
  }

  // Inputs: locked in bucket-id order, then taken in the order given.
  const ids = [...new Set(p.inputs.map((i) => i.bucketId))].sort((a, b) => a - b);
  if (ids.length !== p.inputs.length) throw new ProductionRefusal("Satu saldo produksi hanya boleh diambil sekali per eksekusi.");
  const locked = new Map<number, Bucket>();
  for (const id of ids) {
    const b = await lockBucketById(tx, id);
    if (!b) throw new ProductionRefusal("Saldo produksi input tidak ditemukan. Pilih ulang.");
    if (b.inTransit) throw new ProductionRefusal("Barang yang masih dalam perjalanan belum bisa dikerjakan; terima dulu.");
    if (b.workstationId !== p.workstationId) throw new ProductionRefusal("Input harus berada di workstation eksekusi.");
    locked.set(id, b);
  }

  // The Partai (M112): one at most among the inputs; a Partai is never merged.
  const partai = inputsPartai([...locked.values()].map((b) => b.partaiId));
  if (partai.kind === "many") throw new ProductionRefusal("Input berasal dari lebih dari satu Partai; Partai tidak pernah digabung.");
  if (partai.kind === "one" && p.partaiId != null && p.partaiId !== partai.id) throw new ProductionRefusal("Input bukan bagian dari Partai yang dieksekusi.");
  const partaiId = partai.kind === "one" ? partai.id : (p.partaiId ?? null);
  for (const o of outs) {
    if (o.jobId == null) continue;
    if (partaiId == null) throw new ProductionRefusal("Job hanya ada di dalam Partai.");
    await jobPartai(tx, o.jobId, partaiId);
  }

  const inputs: Produced["inputs"] = [];
  const takenQty: Dec[] = [];
  for (const i of p.inputs) {
    const b = locked.get(i.bucketId)!;
    const qty = new D(i.baseQty);
    const value = await takeLocked(tx, b, qty, "Consumed", p.date, p.source, p.actorId);
    inputs.push({ bucketId: b.id, lotId: b.lotId, itemId: b.itemId, value: value.toNumber() });
    takenQty.push(qty);
  }

  // The supplier the new lots carry: the one behind the inputs' lots (M127).
  const inputLots = await tx.logStockTracking.findMany({ where: { id: { in: inputs.map((i) => i.lotId) } }, select: { source_partner_id: true } });
  const supplierId = carriedSupplier(inputLots.map((l) => l.source_partner_id));

  // The outputs, at Σ input + added, shared by Bobot Biaya.
  const total = inputs.reduce((a, i) => a + i.value, 0) + added;
  const values = shareByWeight(total, weights);
  const outputs: Produced["outputs"] = [];
  for (const [j, o] of outs.entries()) {
    const lot = await tx.logStockTracking.create({
      data: {
        tracking_no: o.lotNo,
        tracking_date: p.date,
        item_id: o.itemId,
        source_doc_type_id: p.source.docTypeId,
        source_doc_id: p.source.docId,
        source_no: p.source.no,
        source_partner_id: supplierId,
        expiry_date: o.expiry,
        created_by: p.actorId,
      },
    });
    const bucket = await openBucket(
      tx,
      { lotId: lot.id, partaiId, jobId: o.jobId ?? null, workstationId: p.workstationId, inTransit: false, itemId: o.itemId, uomId: o.item.base_uom_id },
      p.actorId
    );
    await write(tx, bucket, { movement: "Produced", qty: o.qty, value: new D(values[j]), date: p.date, source: p.source, actorId: p.actorId });
    if (o.reject) await tx.prdBalance.update({ where: { id: bucket.id }, data: { is_reject: true, updated_by: p.actorId } });
    outputs.push({ lotId: lot.id, bucketId: bucket.id, value: values[j] });
  }

  // Genealogy: each input's quantity and value shared over the outputs.
  for (const [i, input] of inputs.entries()) {
    const qtyParts = shareQty(takenQty[i].toNumber(), weights);
    const valueParts = shareByWeight(input.value, weights);
    for (const [j, out] of outputs.entries()) {
      if (!(weights[j] > 0)) continue;
      await tx.prdLotLink.create({
        data: {
          source_doc_type_id: p.source.docTypeId,
          source_doc_id: p.source.docId,
          source_no: p.source.no,
          from_bucket_id: input.bucketId,
          from_lot_id: input.lotId,
          to_lot_id: out.lotId,
          qty: qtyParts[j],
          value: valueParts[j],
        },
      });
    }
  }
  return { inputs, outputs, total, partaiId };
}

/**
 * A pass-through run (P169, AD8): the lot is **kept**. The `main` bucket is taken
 * whole at its value, the `extras` (a box, a wrap) are taken by the quantity
 * given, and the same lot returns to the same bucket at `outQty` — free, so a
 * loss or a gain shows as susut or tambahan (F6) — carrying Σ everything it took
 * plus the run's standard. Cost in = cost out. The extras' genealogy points at
 * the kept lot. Extras belong to no Partai or to the main one's.
 */
export type PassThroughRun = {
  workstationId: number;
  main: { bucketId: number; outQty: number | string };
  extras: ProduceInput[];
  addedValue?: number;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

export type PassedThrough = {
  lotId: number;
  bucketId: number;
  itemId: number;
  partaiId: number | null;
  jobId: number | null;
  inQty: number;
  inValue: number;
  extras: { bucketId: number; lotId: number; itemId: number; value: number }[];
  outValue: number;
};

export async function passThrough(tx: Tx, r: PassThroughRun): Promise<PassedThrough> {
  const added = r.addedValue ?? 0;
  if (!Number.isInteger(added) || added < 0) throw new ProductionRefusal("Biaya konversi harus rupiah utuh, tidak negatif.");
  const outQty = new D(r.main.outQty);
  if (!outQty.gt(0)) throw new ProductionRefusal("Jumlah keluar harus lebih dari 0.");
  if (outQty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
  await activeWorkstation(tx, r.workstationId);
  const ids = [...new Set([r.main.bucketId, ...r.extras.map((e) => e.bucketId)])].sort((a, b) => a - b);
  if (ids.length !== r.extras.length + 1) throw new ProductionRefusal("Satu saldo produksi hanya boleh diambil sekali per eksekusi.");
  const locked = new Map<number, Bucket>();
  for (const id of ids) {
    const b = await lockBucketById(tx, id);
    if (!b) throw new ProductionRefusal("Saldo produksi input tidak ditemukan. Pilih ulang.");
    if (b.inTransit) throw new ProductionRefusal("Barang yang masih dalam perjalanan belum bisa dikerjakan; terima dulu.");
    if (b.workstationId !== r.workstationId) throw new ProductionRefusal("Input harus berada di workstation eksekusi.");
    locked.set(id, b);
  }
  const main = locked.get(r.main.bucketId)!;
  for (const e of r.extras) {
    const x = locked.get(e.bucketId)!;
    if (x.partaiId != null && x.partaiId !== main.partaiId) throw new ProductionRefusal("Input tambahan berasal dari Partai lain; Partai tidak pernah digabung.");
  }
  const item = await productionItem(tx, main.itemId);
  const extras: PassedThrough["extras"] = [];
  const takenQty: Dec[] = [];
  for (const e of r.extras) {
    const x = locked.get(e.bucketId)!;
    const qty = new D(e.baseQty);
    const value = await takeLocked(tx, x, qty, "Consumed", r.date, r.source, r.actorId);
    extras.push({ bucketId: x.id, lotId: x.lotId, itemId: x.itemId, value: value.toNumber() });
    takenQty.push(qty);
  }
  const inQty = main.qty;
  const inValue = await takeLocked(tx, main, inQty, "Consumed", r.date, r.source, r.actorId);
  const outValue = inValue.add(extras.reduce((a, x) => a.add(x.value), new D(0))).add(added);
  await write(tx, main, { movement: "Produced", qty: outQty, value: outValue, date: r.date, source: r.source, actorId: r.actorId });
  for (const [i, x] of extras.entries()) {
    await tx.prdLotLink.create({
      data: {
        source_doc_type_id: r.source.docTypeId,
        source_doc_id: r.source.docId,
        source_no: r.source.no,
        from_bucket_id: x.bucketId,
        from_lot_id: x.lotId,
        to_lot_id: main.lotId,
        qty: takenQty[i],
        value: x.value,
      },
    });
  }
  void item;
  return { lotId: main.lotId, bucketId: main.id, itemId: main.itemId, partaiId: main.partaiId, jobId: main.jobId, inQty: inQty.toNumber(), inValue: inValue.toNumber(), extras, outValue: outValue.toNumber() };
}

// ------------------------------------------------------------ revaluing

/**
 * Adds a whole-rupiah value to a bucket with quantity 0 (M96, the month-end
 * close). Refuses an empty bucket and a result below zero.
 */
export async function revalueBucket(tx: Tx, r: { bucketId: number; value: number; date: Date; source: ProductionSource; actorId: number }): Promise<void> {
  if (!Number.isInteger(r.value)) throw new ProductionRefusal("Nilai penyesuaian harus rupiah utuh.");
  if (r.value === 0) return;
  const b = await lockBucketById(tx, r.bucketId);
  if (!b) throw new ProductionRefusal("Saldo produksi tidak ditemukan.");
  if (!b.qty.gt(0)) throw new ProductionRefusal("Saldo produksi yang kosong tidak dapat dinilai ulang.");
  await write(tx, b, { movement: "Revalued", qty: new D(0), value: new D(r.value), date: r.date, source: r.source, actorId: r.actorId });
}

// ---------------------------------------------------------------- reads

export type BucketView = {
  id: number;
  lotId: number;
  lotNo: string;
  itemId: number;
  itemLabel: string;
  itemName: string;
  workstationId: number;
  workstationLabel: string;
  inTransit: boolean;
  partaiId: number | null;
  partaiNo: string | null;
  jobId: number | null;
  jobNo: string | null;
  expiry: string | null;
  qty: number;
  value: number;
  /** Marked Reject by an execution (AD21). */
  isReject: boolean;
};

const bucketInclude = {
  lot: { select: { tracking_no: true, expiry_date: true } },
  partai: { select: { partai_no: true } },
  job: { select: { job_no: true } },
  item: { select: { item_label: true, item_name: true } },
  workstation: { select: { workstation_label: true } },
} as const;

type BucketRead = Prisma.PrdBalanceGetPayload<{ include: typeof bucketInclude }>;

const view = (b: BucketRead): BucketView => ({
  id: b.id,
  lotId: b.lot_id,
  lotNo: b.lot.tracking_no,
  itemId: b.item_id,
  itemLabel: b.item.item_label,
  itemName: b.item.item_name,
  workstationId: b.workstation_id,
  workstationLabel: b.workstation.workstation_label,
  inTransit: b.in_transit,
  partaiId: b.partai_id,
  partaiNo: b.partai?.partai_no ?? null,
  jobId: b.job_id,
  jobNo: b.job?.job_no ?? null,
  expiry: iso(b.lot.expiry_date),
  qty: b.qty_balance.toNumber(),
  value: b.value_balance.toNumber(),
  isReject: b.is_reject,
});

/**
 * Every bucket holding quantity, for the pickers of executions, receipts and
 * scrap — filtered by workstation, item, Partai or Job, received goods only
 * unless `inTransit` asks for what is on its way; earliest expiry first, then
 * lot. `withIds` brings in buckets a stored document names, whatever they hold now.
 */
export async function availableBuckets(
  filter: { workstationIds?: number[]; itemIds?: number[]; partaiIds?: number[]; jobIds?: number[]; inTransit?: boolean; withIds?: number[] } = {},
  db: Db = prisma
): Promise<BucketView[]> {
  const rows = await db.prdBalance.findMany({
    where: {
      OR: [
        {
          qty_balance: { gt: 0 },
          in_transit: !!filter.inTransit,
          ...(filter.workstationIds?.length ? { workstation_id: { in: filter.workstationIds } } : {}),
          ...(filter.itemIds?.length ? { item_id: { in: filter.itemIds } } : {}),
          ...(filter.partaiIds?.length ? { partai_id: { in: filter.partaiIds } } : {}),
          ...(filter.jobIds?.length ? { job_id: { in: filter.jobIds } } : {}),
        },
        ...(filter.withIds?.length ? [{ id: { in: filter.withIds } }] : []),
      ],
    },
    include: bucketInclude,
  });
  return rows
    .map(view)
    .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.lotNo.localeCompare(b.lotNo) || a.workstationLabel.localeCompare(b.workstationLabel));
}

/** The named buckets, whatever they hold — for a stored document to show what it moved. */
export async function bucketsByIds(ids: number[], db: Db = prisma): Promise<BucketView[]> {
  if (!ids.length) return [];
  return (await db.prdBalance.findMany({ where: { id: { in: ids } }, include: bucketInclude })).map(view);
}

/** Σ value held in production now, per item — what the WIP accounts should hold. */
export async function wipByItem(db: Db = prisma): Promise<Map<number, number>> {
  const rows = await db.prdBalance.groupBy({ by: ["item_id"], _sum: { value_balance: true }, where: { value_balance: { not: 0 } } });
  return new Map(rows.map((r) => [r.item_id, r._sum.value_balance?.toNumber() ?? 0]));
}

/** The Perintah that already started a Partai (P167: each starts one only). */
export async function orderIdsWithPartai(db: Db = prisma): Promise<number[]> {
  const rows = await db.prdPartai.findMany({ where: { order_id: { not: null } }, select: { order_id: true } });
  return rows.flatMap((p) => (p.order_id ? [p.order_id] : []));
}

/** Whether anything of a Partai is still in production — held at a station, in transit or flagged Reject (P170). */
export async function partaiInProduction(partaiId: number, db: Db = prisma): Promise<boolean> {
  return (await db.prdBalance.count({ where: { partai_id: partaiId, qty_balance: { gt: 0 } } })) > 0;
}

/** The Perintah a Partai was started for, if any. */
export async function orderIdOfPartai(partaiId: number, db: Db = prisma): Promise<number | null> {
  return (await db.prdPartai.findUnique({ where: { id: partaiId }, select: { order_id: true } }))?.order_id ?? null;
}
