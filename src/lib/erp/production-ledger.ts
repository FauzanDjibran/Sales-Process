import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { dailySeries, nextDailyNumber, nextDocumentNumber } from "./document-number";
import { costedPeriodRefusal } from "./period-lock";

/**
 * The production ledger (R3, step 3) — the book of what is inside production.
 *
 * A **bucket** (`prd_balance`) is one No. Stok · Unit · stage · Partai · Job
 * (P227; Partai and Job optional), holding quantity Q in the item's base unit
 * and value V in whole rupiah; Σ V is WIP. No. Stok is the stock register
 * (`log_stock_tracking`, one number one stock, W10): stock issued in keeps its
 * number. A Unit holds goods in Persiapan until an execution moves them to
 * Stand By (W29). Every movement is a row of `prd_ledger`, written
 * in the same transaction as the bucket it changes, with the balances after
 * it; one ledger number `MP/YYYY/MM/NNNN` per posting (P110).
 *
 * - **Taking** q from a bucket releases round(V × q ÷ Q), or V whole when q
 *   empties it, so a bucket always ends at 0 / 0 (as P114's pools).
 * - **Advancing** moves goods from Persiapan to Stand By at the same Unit.
 * - **Transferring** sends Stand By goods to another Unit's Persiapan, at the
 *   value released (R7).
 *
 * Only a Barang with Kelola Stok enters production. Buckets are locked
 * `FOR UPDATE` in id order; a document that also moves stock locks the stock
 * pools first.
 *
 * The identities live here too: a partai, a No. Job, what a No. Stok locked
 * when it started, and the standard cost it absorbed.
 *
 * A book: it imports only the shared kernel and is called by the documents,
 * never the reverse (§3.1). It writes no journal — the document posts WIP
 * beside it.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** A movement production refuses — short quantity, an unknown lot, a lot number taken. */
export class ProductionRefusal extends Error {}

export type ProductionSource = { docTypeId: number; docId: number; no: string };

type Movement = "Issued" | "Consumed" | "Produced" | "TransferOut" | "TransferIn" | "Released";

const qtyText = (d: Dec) => d.toDecimalPlaces(6).toString().replace(".", ",");
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

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

async function activeUnit(tx: Tx, id: number) {
  const ws = await tx.refUnit.findUnique({ where: { id }, select: { unit_label: true, status: true } });
  if (!ws) throw new ProductionRefusal("Unit tidak ditemukan.");
  if (ws.status !== "Active") throw new ProductionRefusal(`Unit ${ws.unit_label} nonaktif.`);
  return ws;
}

// ------------------------------------------------------------- locking

type Stage = "Preparation" | "StandBy";
type Bucket = { id: number; lotId: number; unitId: number; stage: Stage; partaiId: number | null; jobId: number | null; itemId: number; qty: Dec; value: Dec };
type BucketKey = { lotId: number; unitId: number; stage: Stage; partaiId: number | null; jobId: number | null; itemId: number; uomId: number };

async function lockBucketById(tx: Tx, id: number): Promise<Bucket | null> {
  const [row] = await tx.$queryRaw<
    { id: number; tracking_id: number; unit_id: number; stage: Stage; partai_id: number | null; job_id: number | null; item_id: number; qty_balance: Dec; value_balance: Dec }[]
  >`
    SELECT "id", "tracking_id", "unit_id", "stage"::text AS "stage", "partai_id", "job_id", "item_id", "qty_balance", "value_balance"
      FROM "prd_balance" WHERE "id" = ${id} FOR UPDATE`;
  return row
    ? {
        id: row.id,
        lotId: row.tracking_id,
        unitId: row.unit_id,
        stage: row.stage,
        partaiId: row.partai_id,
        jobId: row.job_id,
        itemId: row.item_id,
        qty: new D(row.qty_balance),
        value: new D(row.value_balance),
      }
    : null;
}

/** The bucket of this identity, created empty if missing, and locked. */
async function openBucket(tx: Tx, k: BucketKey, actorId: number): Promise<Bucket> {
  await tx.$executeRaw`
    INSERT INTO "prd_balance" ("tracking_id", "unit_id", "stage", "partai_id", "job_id", "item_id", "uom_id", "qty_balance", "value_balance", "created_by", "updated_at")
    VALUES (${k.lotId}, ${k.unitId}, ${k.stage}::"PrdStage", ${k.partaiId}::int, ${k.jobId}::int, ${k.itemId}, ${k.uomId}, 0, 0, ${actorId}, now())
    ON CONFLICT ("tracking_id", "unit_id", "stage", "partai_id", "job_id") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "prd_balance"
     WHERE "tracking_id" = ${k.lotId} AND "unit_id" = ${k.unitId} AND "stage" = ${k.stage}::"PrdStage"
       AND "partai_id" IS NOT DISTINCT FROM ${k.partaiId}::int AND "job_id" IS NOT DISTINCT FROM ${k.jobId}::int`;
  return (await lockBucketById(tx, row.id))!;
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
  // A costed period takes no production posting (R15).
  const costed = await costedPeriodRefusal(m.date, tx);
  if (costed) throw new ProductionRefusal(costed);
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
      tracking_id: b.lotId,
      unit_id: b.unitId,
      stage: b.stage,
      partai_id: b.partaiId,
      job_id: b.jobId,
      item_id: b.itemId,
      qty_change: m.qty,
      qty_balance: qty,
      value_change: m.value,
      value_balance: value,
      created_by: m.actorId,
    },
  });
  b.qty = qty;
  b.value = value;
}

/** round(V × q ÷ Q), or V whole when q empties the bucket. */
function release(b: Bucket, qty: Dec): Dec {
  return qty.eq(b.qty) ? b.value : b.value.mul(qty).div(b.qty).toDecimalPlaces(0, D.ROUND_HALF_UP);
}

async function takeLocked(tx: Tx, b: Bucket, qty: Dec, movement: Movement, date: Date, source: ProductionSource, actorId: number) {
  if (!qty.gt(0)) throw new ProductionRefusal("Jumlah yang diambil harus lebih dari 0.");
  if (qty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
  if (b.qty.lt(qty)) {
    const lot = await tx.logStockTracking.findUnique({ where: { id: b.lotId }, select: { tracking_no: true, item: { select: { item_label: true } } } });
    const ws = await tx.refUnit.findUnique({ where: { id: b.unitId }, select: { unit_label: true } });
    throw new ProductionRefusal(
      `Saldo produksi ${lot?.item.item_label ?? ""} lot ${lot?.tracking_no ?? ""} di ${ws?.unit_label ?? ""} tidak cukup: tersedia ${qtyText(b.qty)}, diminta ${qtyText(qty)}.`
    );
  }
  const value = release(b, qty);
  await write(tx, b, { movement, qty: qty.neg(), value: value.neg(), date, source, actorId });
  return value;
}

// --------------------------------------------------------------- entering

export type ProductionEntry = {
  /** A stock lot (`log_stock_tracking`) of the item, kept in production. */
  lotId: number;
  itemId: number;
  unitId: number;
  /** In the item's base unit. */
  baseQty: number | string | Dec;
  /** Whole rupiah — what the stock issue released. */
  value: number | string | Dec;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

/** Places a stock lot in a Unit's Persiapan (Stock Issue, R4; W29). */
export async function enterProduction(tx: Tx, e: ProductionEntry): Promise<{ bucketId: number }> {
  const qty = new D(e.baseQty);
  const value = new D(e.value);
  if (!qty.gt(0)) throw new ProductionRefusal("Jumlah yang masuk produksi harus lebih dari 0.");
  if (qty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
  if (value.lt(0) || !value.isInteger()) throw new ProductionRefusal("Nilai harus rupiah utuh, tidak negatif.");
  const item = await productionItem(tx, e.itemId);
  await activeUnit(tx, e.unitId);
  const lot = await tx.logStockTracking.findFirst({ where: { id: e.lotId, item_id: e.itemId }, select: { id: true } });
  if (!lot) throw new ProductionRefusal(`Lot ${item.item_label} tidak ditemukan.`);
  const bucket = await openBucket(tx, { lotId: lot.id, unitId: e.unitId, stage: "Preparation", partaiId: null, jobId: null, itemId: e.itemId, uomId: item.base_uom_id }, e.actorId);
  await write(tx, bucket, { movement: "Issued", qty, value, date: e.date, source: e.source, actorId: e.actorId });
  return { bucketId: bucket.id };
}

// ---------------------------------------------------------------- taking

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
  unitId: number;
  expiry: Date | null;
};

/**
 * Takes goods out of production: the bucket
 * releases round(V × q ÷ Q), or V whole when q empties it. Refuses short
 * quantity. Says what the goods were — lot and expiry — so the caller can
 * carry them into stock.
 */
export async function takeFromBucket(tx: Tx, t: ProductionTake): Promise<TakenFromProduction> {
  const b = await lockBucketById(tx, t.bucketId);
  if (!b) throw new ProductionRefusal("Saldo produksi tidak ditemukan. Pilih ulang.");
  const value = await takeLocked(tx, b, new D(t.baseQty), "Released", t.date, t.source, t.actorId);
  const lot = await tx.logStockTracking.findUniqueOrThrow({ where: { id: b.lotId }, select: { tracking_no: true, expiry_date: true } });
  return { value: value.toNumber(), lotId: b.lotId, lotNo: lot.tracking_no, itemId: b.itemId, unitId: b.unitId, expiry: lot.expiry_date };
}

/**
 * Moves q from Persiapan to Stand By at the same Unit, No. Stok, Partai and
 * Job, at the value released (W29). Only an execution calls this (W30).
 */
export async function advanceToStandBy(tx: Tx, t: ProductionTake): Promise<{ value: number; toBucketId: number }> {
  const from = await lockBucketById(tx, t.bucketId);
  if (!from) throw new ProductionRefusal("Saldo produksi tidak ditemukan. Pilih ulang.");
  if (from.stage !== "Preparation") throw new ProductionRefusal("Barang ini sudah di Stand By.");
  const item = await productionItem(tx, from.itemId);
  const to = await openBucket(tx, { lotId: from.lotId, unitId: from.unitId, stage: "StandBy", partaiId: from.partaiId, jobId: from.jobId, itemId: from.itemId, uomId: item.base_uom_id }, t.actorId);
  const value = await takeLocked(tx, from, new D(t.baseQty), "Consumed", t.date, t.source, t.actorId);
  await write(tx, to, { movement: "Produced", qty: new D(t.baseQty), value, date: t.date, source: t.source, actorId: t.actorId });
  return { value: value.toNumber(), toBucketId: to.id };
}

/**
 * Sends q of a Stand By bucket to another Unit's Persiapan (BSTB, R7, W29):
 * out at round(V × q ÷ Q) — V whole when it empties — and in at the same value.
 * `partaiId` and `jobId` give the goods a new identity; left out, they keep
 * theirs, and null drops it (W21, Penyebaran).
 */
export async function transferBucket(
  tx: Tx,
  t: ProductionTake & { toUnitId: number; partaiId?: number | null; jobId?: number | null }
): Promise<{ value: number; toBucketId: number; lotId: number; itemId: number }> {
  const from = await lockBucketById(tx, t.bucketId);
  if (!from) throw new ProductionRefusal("Saldo produksi tidak ditemukan. Pilih ulang.");
  if (from.unitId === t.toUnitId) throw new ProductionRefusal("Unit tujuan sama dengan asalnya.");
  if (from.stage !== "StandBy") throw new ProductionRefusal("Hanya barang di Stand By yang dapat dikirim: barang Persiapan belum dikerjakan.");
  await activeUnit(tx, t.toUnitId);
  const item = await productionItem(tx, from.itemId);
  // The destination exists before either is locked twice; locks then follow id order.
  const to = await openBucket(
    tx,
    {
      lotId: from.lotId,
      unitId: t.toUnitId,
      stage: "Preparation",
      partaiId: t.partaiId === undefined ? from.partaiId : t.partaiId,
      jobId: t.jobId === undefined ? from.jobId : t.jobId,
      itemId: from.itemId,
      uomId: item.base_uom_id,
    },
    t.actorId
  );
  const value = await takeLocked(tx, from, new D(t.baseQty), "TransferOut", t.date, t.source, t.actorId);
  await write(tx, to, { movement: "TransferIn", qty: new D(t.baseQty), value, date: t.date, source: t.source, actorId: t.actorId });
  return { value: value.toNumber(), toBucketId: to.id, lotId: from.lotId, itemId: from.itemId };
}

// ------------------------------------------------------------- identities

/** The one active Standard Cost version, or a refusal: production needs a version to lock (W36). */
async function activeRateVersion(tx: Tx): Promise<number> {
  const v = await tx.prdRateVersion.findFirst({ where: { status: "Active" }, select: { id: true } });
  if (!v) throw new ProductionRefusal("Belum ada Standard Cost aktif. Buat dulu di Master.");
  return v.id;
}

/** Numbers within a day never collide: the series is locked until the transaction ends. */
async function lockSeries(tx: Tx, series: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${series}))`;
}

/**
 * Forms a partai on one line: it names the routing it follows, which must be
 * that line's, and keeps the id of the Standard Cost active today.
 */
export async function formPartai(
  tx: Tx,
  p: { lineId: number; routingId: number; date: Date; source: ProductionSource; actorId: number }
): Promise<{ id: number; no: string; rateVersionId: number }> {
  const line = await tx.prdLine.findUnique({ where: { id: p.lineId }, select: { line_label: true, status: true } });
  if (!line) throw new ProductionRefusal("Line tidak ditemukan.");
  if (line.status !== "Active") throw new ProductionRefusal(`Line ${line.line_label} nonaktif.`);
  const routing = await tx.prdRouting.findUnique({ where: { id: p.routingId }, select: { routing_label: true, line_id: true, status: true } });
  if (!routing) throw new ProductionRefusal("Routing tidak ditemukan.");
  if (routing.line_id !== p.lineId) throw new ProductionRefusal(`Routing ${routing.routing_label} bukan milik line ${line.line_label}.`);
  if (routing.status !== "Active") throw new ProductionRefusal(`Routing ${routing.routing_label} nonaktif.`);
  const rateVersionId = await activeRateVersion(tx);
  const series = dailySeries("P", p.date);
  await lockSeries(tx, series);
  const last = await tx.prdPartai.findFirst({ where: { partai_no: { startsWith: series } }, orderBy: { partai_no: "desc" }, select: { partai_no: true } });
  const no = nextDailyNumber(series, last?.partai_no ?? null);
  const row = await tx.prdPartai.create({
    data: {
      partai_no: no,
      partai_date: p.date,
      line_id: p.lineId,
      routing_id: p.routingId,
      rate_version_id: rateVersionId,
      source_doc_type_id: p.source.docTypeId,
      source_doc_id: p.source.docId,
      source_no: p.source.no,
      created_by: p.actorId,
    },
  });
  return { id: row.id, no, rateVersionId };
}

/** A No. Job: one pickup of one No. Stok at the Unit issuing it (W31). */
export async function issueJob(
  tx: Tx,
  j: { unitId: number; lotId: number; partaiId?: number | null; date: Date; source: ProductionSource; actorId: number }
): Promise<{ id: number; no: string }> {
  const unit = await activeUnit(tx, j.unitId);
  const series = dailySeries(unit.unit_label, j.date);
  await lockSeries(tx, series);
  const last = await tx.prdJob.findFirst({ where: { job_no: { startsWith: series } }, orderBy: { job_no: "desc" }, select: { job_no: true } });
  const no = nextDailyNumber(series, last?.job_no ?? null);
  const row = await tx.prdJob.create({
    data: {
      job_no: no,
      job_date: j.date,
      unit_id: j.unitId,
      tracking_id: j.lotId,
      partai_id: j.partaiId ?? null,
      source_doc_type_id: j.source.docTypeId,
      source_doc_id: j.source.docId,
      source_no: j.source.no,
      created_by: j.actorId,
    },
  });
  return { id: row.id, no };
}

/**
 * Records what a No. Stok locked when it started production (§7): the Standard
 * Cost active today and the segment before the partai, unless given (an output
 * inherits its input's). Once only: a later call returns what was locked.
 */
export async function recordTrackingInfo(
  tx: Tx,
  i: { lotId: number; grams?: number | string | Dec | null; form?: "Bulk" | "Piece" | "Box"; rateVersionId?: number; routingId?: number | null; actorId: number }
): Promise<{ rateVersionId: number; routingId: number | null }> {
  const known = await tx.prdTrackingInfo.findUnique({ where: { tracking_id: i.lotId } });
  if (known) return { rateVersionId: known.rate_version_id, routingId: known.routing_id };
  const rateVersionId = i.rateVersionId ?? (await activeRateVersion(tx));
  let routingId = i.routingId;
  if (routingId === undefined) {
    const segment = await tx.prdRouting.findFirst({ where: { line_id: null, status: "Active" }, select: { id: true } });
    if (!segment) throw new ProductionRefusal("Belum ada routing sebelum partai. Buat dulu di Master.");
    routingId = segment.id;
  }
  await tx.prdTrackingInfo.create({
    data: {
      tracking_id: i.lotId,
      rate_version_id: rateVersionId,
      routing_id: routingId,
      grams: i.grams == null ? null : new D(i.grams),
      form: i.form ?? "Bulk",
      created_by: i.actorId,
    },
  });
  return { rateVersionId, routingId };
}

/**
 * Standard cost a Unit absorbs: round(grams × rate of the locked version), a
 * Unit the version leaves out costing 0 (W17). The line comes from the partai;
 * before one exists there is none. Writes no journal; the document posts it.
 */
export async function recordCostEntry(
  tx: Tx,
  c: { unitId: number; rateVersionId: number; lotId: number; partaiId?: number | null; grams: number | string | Dec; date: Date; source: ProductionSource; actorId: number }
): Promise<{ amount: number; rate: number }> {
  const costed = await costedPeriodRefusal(c.date, tx);
  if (costed) throw new ProductionRefusal(costed);
  const grams = new D(c.grams);
  if (!grams.gt(0)) throw new ProductionRefusal("Gram harus lebih dari 0.");
  const line = await tx.prdRateVersionLine.findUnique({ where: { version_id_unit_id: { version_id: c.rateVersionId, unit_id: c.unitId } }, select: { rate: true } });
  const rate = line ? new D(line.rate) : new D(0);
  const amount = grams.mul(rate).toDecimalPlaces(0, D.ROUND_HALF_UP);
  const partai = c.partaiId ? await tx.prdPartai.findUnique({ where: { id: c.partaiId }, select: { line_id: true } }) : null;
  await tx.prdCostEntry.create({
    data: {
      posting_date: c.date,
      source_doc_type_id: c.source.docTypeId,
      source_doc_id: c.source.docId,
      source_no: c.source.no,
      unit_id: c.unitId,
      rate_version_id: c.rateVersionId,
      tracking_id: c.lotId,
      partai_id: c.partaiId ?? null,
      line_id: partai?.line_id ?? null,
      grams,
      rate,
      amount,
      created_by: c.actorId,
    },
  });
  return { amount: amount.toNumber(), rate: rate.toNumber() };
}

// ---------------------------------------------------------------- reads

export type BucketView = {
  id: number;
  lotId: number;
  lotNo: string;
  itemId: number;
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  unitId: number;
  unitLabel: string;
  unitName: string;
  stage: Stage;
  partaiId: number | null;
  partaiNo: string | null;
  jobId: number | null;
  jobNo: string | null;
  expiry: string | null;
  qty: number;
  value: number;
};

const bucketInclude = {
  tracking: { select: { tracking_no: true, expiry_date: true } },
  item: { select: { item_label: true, item_name: true } },
  uom: { select: { uom_label: true } },
  unit: { select: { unit_label: true, unit_name: true } },
  partai: { select: { partai_no: true } },
  job: { select: { job_no: true } },
} as const;

type BucketRow = Prisma.PrdBalanceGetPayload<{ include: typeof bucketInclude }>;

const view = (b: BucketRow): BucketView => ({
  id: b.id,
  lotId: b.tracking_id,
  lotNo: b.tracking.tracking_no,
  itemId: b.item_id,
  itemLabel: b.item.item_label,
  itemName: b.item.item_name,
  uomLabel: b.uom.uom_label,
  unitId: b.unit_id,
  unitLabel: b.unit.unit_label,
  unitName: b.unit.unit_name,
  stage: b.stage,
  partaiId: b.partai_id,
  partaiNo: b.partai?.partai_no ?? null,
  jobId: b.job_id,
  jobNo: b.job?.job_no ?? null,
  expiry: iso(b.tracking.expiry_date),
  qty: b.qty_balance.toNumber(),
  value: b.value_balance.toNumber(),
});

/**
 * Every bucket holding quantity, for the pickers of executions, transfers and
 * releases — filtered by unit or item; earliest expiry first, then lot.
 * `withIds` brings in buckets a stored document names, whatever they hold now.
 */
export async function availableBuckets(
  filter: { unitIds?: number[]; itemIds?: number[]; withIds?: number[] } = {},
  db: Db = prisma
): Promise<BucketView[]> {
  const rows = await db.prdBalance.findMany({
    where: {
      OR: [
        {
          qty_balance: { gt: 0 },
          ...(filter.unitIds?.length ? { unit_id: { in: filter.unitIds } } : {}),
          ...(filter.itemIds?.length ? { item_id: { in: filter.itemIds } } : {}),
        },
        ...(filter.withIds?.length ? [{ id: { in: filter.withIds } }] : []),
      ],
    },
    include: bucketInclude,
  });
  return rows
    .map(view)
    .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.lotNo.localeCompare(b.lotNo) || a.unitLabel.localeCompare(b.unitLabel));
}

/** The buckets by id, whatever they hold — for a stored document's lines. */
export async function bucketsByIds(ids: number[], db: Db = prisma): Promise<Map<number, BucketView>> {
  if (!ids.length) return new Map();
  const rows = await db.prdBalance.findMany({ where: { id: { in: [...new Set(ids)] } }, include: bucketInclude });
  return new Map(rows.map((r) => [r.id, view(r)]));
}

/** Σ value held in production now, per item — what the WIP accounts should hold. */
export async function wipByItem(db: Db = prisma): Promise<Map<number, number>> {
  const rows = await db.prdBalance.groupBy({ by: ["item_id"], _sum: { value_balance: true }, where: { value_balance: { not: 0 } } });
  return new Map(rows.map((r) => [r.item_id, r._sum.value_balance?.toNumber() ?? 0]));
}

/** Whether anything moved in production between two dates — what the year-end guard asks (R28). */
export async function hasProductionMovement(from: Date, to: Date, db: Db = prisma): Promise<boolean> {
  return Boolean(await db.prdLedger.findFirst({ where: { posting_date: { gte: from, lte: to } }, select: { id: true } }));
}

/** The Unit goods enter production at: the first step of the segment before the partai (W2). */
export async function firstProductionUnit(db: Db = prisma): Promise<number | null> {
  const segment = await db.prdRouting.findFirst({
    where: { line_id: null, status: "Active" },
    select: { steps: { orderBy: { seq: "asc" }, take: 1, select: { unit_id: true } } },
  });
  return segment?.steps[0]?.unit_id ?? null;
}

/** Whether a partai or a started No. Stok follows this routing: its steps may no longer change. */
export async function routingInUse(routingId: number): Promise<boolean> {
  const [partai, info] = await Promise.all([
    prisma.prdPartai.count({ where: { routing_id: routingId } }),
    prisma.prdTrackingInfo.count({ where: { routing_id: routingId } }),
  ]);
  return partai + info > 0;
}

/** Every routing goods follow, for the list that marks them locked. */
export async function routingsInUse(): Promise<Set<number>> {
  const [partai, info] = await Promise.all([
    prisma.prdPartai.findMany({ distinct: ["routing_id"], select: { routing_id: true } }),
    prisma.prdTrackingInfo.findMany({ distinct: ["routing_id"], select: { routing_id: true } }),
  ]);
  return new Set([...partai, ...info].flatMap((r) => (r.routing_id == null ? [] : [r.routing_id])));
}

/** Whether any stock of the item has ever been in production — what locks its BJL flag (W32). */
export async function itemUsedInProduction(itemId: number): Promise<boolean> {
  return (await prisma.prdLedger.count({ where: { tracking: { item_id: itemId } } })) > 0;
}
