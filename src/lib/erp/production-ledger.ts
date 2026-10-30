import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { outputWeight, shareByWeight, shareQty } from "./production-execution";

/**
 * The production ledger (R3, step 3) — the book of what is inside production.
 *
 * A **bucket** (`prd_balance`) is one lot at one workstation, holding quantity
 * Q in the item's base unit and value V in whole rupiah; Σ V is WIP. Lots are
 * the stock lots (`log_stock_tracking`, unique per item, P120): a stock lot
 * issued in keeps its number, and each execution output is a **new lot**
 * registered here (R5, R17). Every movement is a row of `prd_ledger`, written
 * in the same transaction as the bucket it changes, with the balances after
 * it; one ledger number `MP/YYYY/MM/NNNN` per posting (P110).
 *
 * - **Taking** q from a bucket releases round(V × q ÷ Q), or V whole when q
 *   empties it, so a bucket always ends at 0 / 0 (as P114's pools).
 * - **Transferring** takes from one bucket and puts the same lot, quantity and
 *   value in another workstation's (R7).
 * - **Producing** takes every input and shares Σ input value over the outputs
 *   by qty × Bobot Nilai (R6), creates each output lot and its bucket, and
 *   writes the genealogy — what each input gave each output (`prd_lot_link`),
 *   which the month-end close follows forward (R12).
 * - **Revaluing** adds a value with quantity 0 — the month-end close.
 *
 * Only a Barang with Kelola Stok enters production. Buckets are locked
 * `FOR UPDATE` in id order; a document that also moves stock locks the stock
 * pools first.
 *
 * A book: it imports only the shared kernel (and the pure execution
 * arithmetic) and is called by the documents, never the reverse (§3.1). It
 * writes no journal — the document posts WIP beside it.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** A movement production refuses — short quantity, an unknown lot, a lot number taken. */
export class ProductionRefusal extends Error {}

export type ProductionSource = { docTypeId: number; docId: number; no: string };

type Movement = "Issued" | "Consumed" | "Produced" | "TransferOut" | "TransferIn" | "Released" | "Revalued";

const qtyText = (d: Dec) => d.toDecimalPlaces(6).toString().replace(".", ",");
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const describe = (value: Dec, qty: Dec) => (qty.isZero() ? new D(0) : value.abs().div(qty.abs()).toDecimalPlaces(6, D.ROUND_HALF_UP));

// ------------------------------------------------------------- masters

async function productionItem(tx: Tx, itemId: number) {
  const item = await tx.mItem.findUnique({
    where: { id: itemId },
    select: { item_label: true, item_type: true, track_stock: true, has_expiry: true, base_uom_id: true, value_weight: true },
  });
  if (!item) throw new ProductionRefusal("Barang tidak ditemukan.");
  if (item.item_type !== "Barang" || !item.track_stock) {
    throw new ProductionRefusal(`${item.item_label} tidak dikelola stok (Kelola Stok tidak aktif), jadi tidak bisa masuk produksi.`);
  }
  return item;
}

async function activeWorkstation(tx: Tx, id: number) {
  const ws = await tx.refWorkstation.findUnique({ where: { id }, select: { workstation_label: true, status: true } });
  if (!ws) throw new ProductionRefusal("Workstation tidak ditemukan.");
  if (ws.status !== "Active") throw new ProductionRefusal(`Workstation ${ws.workstation_label} nonaktif.`);
  return ws;
}

// ------------------------------------------------------------- locking

type Bucket = { id: number; lotId: number; workstationId: number; itemId: number; qty: Dec; value: Dec };

async function lockBucketById(tx: Tx, id: number): Promise<Bucket | null> {
  const [row] = await tx.$queryRaw<{ id: number; lot_id: number; workstation_id: number; item_id: number; qty_balance: Dec; value_balance: Dec }[]>`
    SELECT "id", "lot_id", "workstation_id", "item_id", "qty_balance", "value_balance" FROM "prd_balance" WHERE "id" = ${id} FOR UPDATE`;
  return row
    ? { id: row.id, lotId: row.lot_id, workstationId: row.workstation_id, itemId: row.item_id, qty: new D(row.qty_balance), value: new D(row.value_balance) }
    : null;
}

/** The lot's bucket at the workstation, created empty if missing, and locked. */
async function openBucket(tx: Tx, k: { lotId: number; workstationId: number; itemId: number; uomId: number }, actorId: number): Promise<Bucket> {
  await tx.$executeRaw`
    INSERT INTO "prd_balance" ("lot_id", "workstation_id", "item_id", "uom_id", "qty_balance", "value_balance", "created_by", "updated_at")
    VALUES (${k.lotId}, ${k.workstationId}, ${k.itemId}, ${k.uomId}, 0, 0, ${actorId}, now())
    ON CONFLICT ("lot_id", "workstation_id") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "prd_balance" WHERE "lot_id" = ${k.lotId} AND "workstation_id" = ${k.workstationId}`;
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
      workstation_id: b.workstationId,
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

/** round(V × q ÷ Q), or V whole when q empties the bucket. */
function release(b: Bucket, qty: Dec): Dec {
  return qty.eq(b.qty) ? b.value : b.value.mul(qty).div(b.qty).toDecimalPlaces(0, D.ROUND_HALF_UP);
}

async function takeLocked(tx: Tx, b: Bucket, qty: Dec, movement: Movement, date: Date, source: ProductionSource, actorId: number) {
  if (!qty.gt(0)) throw new ProductionRefusal("Jumlah yang diambil harus lebih dari 0.");
  if (qty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
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

// --------------------------------------------------------------- entering

export type ProductionEntry = {
  /** A stock lot (`log_stock_tracking`) of the item, kept in production. */
  lotId: number;
  itemId: number;
  workstationId: number;
  /** In the item's base unit. */
  baseQty: number | string | Dec;
  /** Whole rupiah — what the stock issue released. */
  value: number | string | Dec;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

/** Places a stock lot in production at a workstation (Stock Issue, R4). */
export async function enterProduction(tx: Tx, e: ProductionEntry): Promise<{ bucketId: number }> {
  const qty = new D(e.baseQty);
  const value = new D(e.value);
  if (!qty.gt(0)) throw new ProductionRefusal("Jumlah yang masuk produksi harus lebih dari 0.");
  if (qty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
  if (value.lt(0) || !value.isInteger()) throw new ProductionRefusal("Nilai harus rupiah utuh, tidak negatif.");
  const item = await productionItem(tx, e.itemId);
  await activeWorkstation(tx, e.workstationId);
  const lot = await tx.logStockTracking.findFirst({ where: { id: e.lotId, item_id: e.itemId }, select: { id: true } });
  if (!lot) throw new ProductionRefusal(`Lot ${item.item_label} tidak ditemukan.`);
  const bucket = await openBucket(tx, { lotId: lot.id, workstationId: e.workstationId, itemId: e.itemId, uomId: item.base_uom_id }, e.actorId);
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
  workstationId: number;
  expiry: Date | null;
};

/**
 * Takes goods out of production (Production Release, R8): the bucket
 * releases round(V × q ÷ Q), or V whole when q empties it. Refuses short
 * quantity. Says what the goods were — lot and expiry — so the caller can
 * carry them into stock.
 */
export async function takeFromBucket(tx: Tx, t: ProductionTake): Promise<TakenFromProduction> {
  const b = await lockBucketById(tx, t.bucketId);
  if (!b) throw new ProductionRefusal("Saldo produksi tidak ditemukan. Pilih ulang.");
  const value = await takeLocked(tx, b, new D(t.baseQty), "Released", t.date, t.source, t.actorId);
  const lot = await tx.logStockTracking.findUniqueOrThrow({ where: { id: b.lotId }, select: { tracking_no: true, expiry_date: true } });
  return { value: value.toNumber(), lotId: b.lotId, lotNo: lot.tracking_no, itemId: b.itemId, workstationId: b.workstationId, expiry: lot.expiry_date };
}

/**
 * Moves q of a lot from its bucket to another workstation's (Production
 * Transfer, R7): out at round(V × q ÷ Q) — V whole when it empties — and in at
 * the same value. Both buckets locked in id order.
 */
export async function transferBucket(
  tx: Tx,
  t: ProductionTake & { toWorkstationId: number }
): Promise<{ value: number; toBucketId: number; lotId: number; itemId: number }> {
  const from = await lockBucketById(tx, t.bucketId);
  if (!from) throw new ProductionRefusal("Saldo produksi tidak ditemukan. Pilih ulang.");
  if (from.workstationId === t.toWorkstationId) throw new ProductionRefusal("Workstation tujuan sama dengan asalnya.");
  await activeWorkstation(tx, t.toWorkstationId);
  const item = await productionItem(tx, from.itemId);
  // The destination exists before either is locked twice; locks then follow id order.
  const to = await openBucket(tx, { lotId: from.lotId, workstationId: t.toWorkstationId, itemId: from.itemId, uomId: item.base_uom_id }, t.actorId);
  const value = await takeLocked(tx, from, new D(t.baseQty), "TransferOut", t.date, t.source, t.actorId);
  await write(tx, to, { movement: "TransferIn", qty: new D(t.baseQty), value, date: t.date, source: t.source, actorId: t.actorId });
  return { value: value.toNumber(), toBucketId: to.id, lotId: from.lotId, itemId: from.itemId };
}

// ------------------------------------------------------------ producing

export type ProduceInput = { bucketId: number; baseQty: number | string };

export type ProduceOutput = {
  itemId: number;
  /** A new lot number for the item (R17). */
  lotNo: string;
  expiry: Date | null;
  baseQty: number | string;
};

export type Production = {
  workstationId: number;
  inputs: ProduceInput[];
  outputs: ProduceOutput[];
  date: Date;
  source: ProductionSource;
  actorId: number;
};

export type Produced = {
  /** Per input, in the order given: what it released. */
  inputs: { bucketId: number; lotId: number; itemId: number; value: number }[];
  /** Per output, in the order given: its lot, bucket, weight and value. */
  outputs: { lotId: number; bucketId: number; weight: number; value: number }[];
  /** Σ input value = Σ output value. */
  total: number;
};

/**
 * One execution, balanced (R5, R6): takes every input from the execution's
 * workstation, shares Σ input value over the outputs by qty × Bobot Nilai
 * (largest remainder), registers each output as a new lot of its item with its
 * bucket at the workstation, and records the genealogy. Refuses an execution
 * whose outputs all weigh 0. Called inside the execution's posting.
 */
export async function produce(tx: Tx, p: Production): Promise<Produced> {
  if (!p.inputs.length) throw new ProductionRefusal("Eksekusi memerlukan minimal satu input.");
  if (!p.outputs.length) throw new ProductionRefusal("Eksekusi memerlukan minimal satu output.");
  await activeWorkstation(tx, p.workstationId);

  // Outputs checked first, nothing written.
  const seen = new Set<string>();
  const outs = [];
  for (const o of p.outputs) {
    const item = await productionItem(tx, o.itemId);
    const qty = new D(o.baseQty);
    if (!qty.gt(0)) throw new ProductionRefusal(`Jumlah output ${item.item_label} harus lebih dari 0.`);
    if (qty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
    const lotNo = String(o.lotNo ?? "").trim().toUpperCase();
    if (!lotNo) throw new ProductionRefusal(`Isi No. Lot output ${item.item_label}.`);
    if (seen.has(`${o.itemId}:${lotNo}`)) throw new ProductionRefusal(`Lot ${lotNo} ${item.item_label} dipakai dua kali.`);
    seen.add(`${o.itemId}:${lotNo}`);
    if (await tx.logStockTracking.findUnique({ where: { item_id_tracking_no: { item_id: o.itemId, tracking_no: lotNo } }, select: { id: true } })) {
      throw new ProductionRefusal(`Lot ${lotNo} ${item.item_label} sudah ada; lot output selalu baru.`);
    }
    if (item.has_expiry && !o.expiry) throw new ProductionRefusal(`${item.item_label} memiliki kadaluarsa: isi tanggal kadaluarsa lot ${lotNo}.`);
    outs.push({ ...o, lotNo, qty, item, weight: outputWeight(qty.toNumber(), item.value_weight?.toNumber()) });
  }
  const weights = outs.map((o) => o.weight);
  if (!(weights.reduce((a, w) => a + w, 0) > 0)) {
    throw new ProductionRefusal("Semua output berbobot 0: isi Bobot Nilai pada barang output, minimal satu.");
  }

  // Inputs: locked in bucket-id order, then taken in the order given.
  const ids = [...new Set(p.inputs.map((i) => i.bucketId))].sort((a, b) => a - b);
  if (ids.length !== p.inputs.length) throw new ProductionRefusal("Satu saldo produksi hanya boleh diambil sekali per eksekusi.");
  const locked = new Map<number, Bucket>();
  for (const id of ids) {
    const b = await lockBucketById(tx, id);
    if (!b) throw new ProductionRefusal("Saldo produksi input tidak ditemukan. Pilih ulang.");
    if (b.workstationId !== p.workstationId) throw new ProductionRefusal("Input harus berada di workstation eksekusi ini.");
    locked.set(id, b);
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

  const total = inputs.reduce((a, i) => a + i.value, 0);
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
        expiry_date: o.expiry,
        created_by: p.actorId,
      },
    });
    const bucket = await openBucket(tx, { lotId: lot.id, workstationId: p.workstationId, itemId: o.itemId, uomId: o.item.base_uom_id }, p.actorId);
    await write(tx, bucket, { movement: "Produced", qty: o.qty, value: new D(values[j]), date: p.date, source: p.source, actorId: p.actorId });
    outputs.push({ lotId: lot.id, bucketId: bucket.id, weight: o.weight, value: values[j] });
  }

  // Genealogy: each input's quantity and value shared over the outputs that carry value.
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
  return { inputs, outputs, total };
}

// ------------------------------------------------------------ revaluing

/**
 * Adds a whole-rupiah value to a bucket with quantity 0 (the month-end close).
 * Refuses an empty bucket and a result below zero.
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
  uomLabel: string;
  valueWeight: number | null;
  workstationId: number;
  workstationLabel: string;
  workstationName: string;
  expiry: string | null;
  qty: number;
  value: number;
};

const bucketInclude = {
  lot: { select: { tracking_no: true, expiry_date: true } },
  item: { select: { item_label: true, item_name: true, value_weight: true } },
  uom: { select: { uom_label: true } },
  workstation: { select: { workstation_label: true, workstation_name: true } },
} as const;

type BucketRow = Prisma.PrdBalanceGetPayload<{ include: typeof bucketInclude }>;

const view = (b: BucketRow): BucketView => ({
  id: b.id,
  lotId: b.lot_id,
  lotNo: b.lot.tracking_no,
  itemId: b.item_id,
  itemLabel: b.item.item_label,
  itemName: b.item.item_name,
  uomLabel: b.uom.uom_label,
  valueWeight: b.item.value_weight?.toNumber() ?? null,
  workstationId: b.workstation_id,
  workstationLabel: b.workstation.workstation_label,
  workstationName: b.workstation.workstation_name,
  expiry: iso(b.lot.expiry_date),
  qty: b.qty_balance.toNumber(),
  value: b.value_balance.toNumber(),
});

/**
 * Every bucket holding quantity, for the pickers of executions, transfers and
 * releases — filtered by workstation or item; earliest expiry first, then lot.
 * `withIds` brings in buckets a stored document names, whatever they hold now.
 */
export async function availableBuckets(
  filter: { workstationIds?: number[]; itemIds?: number[]; withIds?: number[] } = {},
  db: Db = prisma
): Promise<BucketView[]> {
  const rows = await db.prdBalance.findMany({
    where: {
      OR: [
        {
          qty_balance: { gt: 0 },
          ...(filter.workstationIds?.length ? { workstation_id: { in: filter.workstationIds } } : {}),
          ...(filter.itemIds?.length ? { item_id: { in: filter.itemIds } } : {}),
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
