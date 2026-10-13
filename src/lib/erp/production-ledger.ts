import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { batchOutcome, shareByWeight, shareQty, type BatchRef } from "./production-execution";

/**
 * The production ledger (P150 E2, E3; `production_project.md` §6, §7.2) — the
 * book of what is inside production.
 *
 * A **bucket** (`prd_balance`) is one lot at one workstation, holding quantity
 * Q in the item's base unit and value V in whole rupiah; Σ V is WIP. Buckets
 * are never pooled with one another and do not follow the stock moving
 * average (G12): a stock lot issued in keeps its number and its issue value,
 * and each execution output is a new lot (M11, M22). Every movement is a row
 * of `prd_ledger`, written in the same transaction as the bucket it changes,
 * with the balances after it; one ledger number `MP/YYYY/MM/NNNN` per posting
 * (P110).
 *
 * - **Taking** q from a bucket releases round(V × q ÷ Q), or V whole when q
 *   empties it, so a bucket always ends at 0 / 0 (M11, as P114's pools).
 * - **Producing** (an execution) takes every input, adds the execution's
 *   standard conversion (P155 M92), shares the total over the outputs by
 *   Bobot Biaya, creates each output lot and its bucket, and writes the
 *   genealogy: what each input gave each output (`prd_lot_link`). Cost in =
 *   cost out (G3).
 * - **The batch** (M41, M42) is carried on the lots: decided by the inputs'
 *   batches, or started by the execution.
 * - **Revaluing** adds a value with quantity 0 — the month-end close (M96).
 *
 * Only a Barang with Kelola Stok enters production (M8). Buckets are locked
 * `FOR UPDATE` in id order; a document that also moves stock locks the stock
 * pools first (§16 X23).
 *
 * A book: it imports only the shared kernel (and the pure execution
 * arithmetic) and is called by the documents, never the reverse (§3.1). It
 * writes no journal — the document posts WIP beside it. Its tables are named
 * only here.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** A movement production refuses — short quantity, an unknown lot, a batch clash. */
export class ProductionRefusal extends Error {}

export type ProductionSource = { docTypeId: number; docId: number; no: string };

type Movement = "Issued" | "Consumed" | "Produced" | "Released" | "Revalued";

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

/** round(V × q ÷ Q), or V whole when q empties the bucket (M11). */
function release(b: Bucket, qty: Dec): Dec {
  return qty.eq(b.qty) ? b.value : b.value.mul(qty).div(b.qty).toDecimalPlaces(0, D.ROUND_HALF_UP);
}

async function takeLocked(tx: Tx, b: Bucket, qty: Dec, movement: Movement, date: Date, source: ProductionSource, actorId: number) {
  if (!qty.gt(0)) throw new ProductionRefusal("Jumlah yang diambil harus lebih dari 0.");
  if (b.qty.lt(qty)) {
    const lot = await tx.prdLot.findUnique({ where: { id: b.lotId }, select: { lot_no: true, item: { select: { item_label: true } } } });
    const ws = await tx.refWorkstation.findUnique({ where: { id: b.workstationId }, select: { workstation_label: true } });
    throw new ProductionRefusal(
      `Saldo produksi ${lot?.item.item_label ?? ""} lot ${lot?.lot_no ?? ""} di ${ws?.workstation_label ?? ""} tidak cukup: tersedia ${qtyText(b.qty)}, diminta ${qtyText(qty)}.`
    );
  }
  const value = release(b, qty);
  await write(tx, b, { movement, qty: qty.neg(), value: value.neg(), date, source, actorId });
  return value;
}

// --------------------------------------------------------------- lots

async function lotBatch(tx: Tx, lotId: number): Promise<BatchRef | null> {
  const lot = await tx.prdLot.findUnique({ where: { id: lotId }, select: { batch: { select: { id: true, batch_no: true } } } });
  return lot?.batch ? { id: lot.batch.id, no: lot.batch.batch_no } : null;
}

export type ProductionEntry = {
  itemId: number;
  /** The stock lot's number, kept in production (M22). */
  lotNo: string;
  /** The stock lot's batch, when it carries one (M45). */
  batch?: BatchRef | null;
  expiry: Date | null;
  workstationId: number;
  /** In the item's base unit. */
  baseQty: number | string | Dec;
  /** Whole rupiah — what the stock issue released. */
  value: number | string | Dec;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

/**
 * Places goods in production at a workstation (Pengeluaran ke Produksi): finds
 * or creates the production lot of that number, then its bucket there, and
 * adds Q and V. A lot already known keeps its batch and expiry; a different
 * one is refused.
 */
export async function enterProduction(tx: Tx, e: ProductionEntry): Promise<{ lotId: number; bucketId: number }> {
  const qty = new D(e.baseQty);
  const value = new D(e.value);
  if (!qty.gt(0)) throw new ProductionRefusal("Jumlah yang masuk produksi harus lebih dari 0.");
  if (qty.decimalPlaces() > 6) throw new ProductionRefusal("Jumlah paling banyak 6 angka desimal.");
  if (value.lt(0) || !value.isInteger()) throw new ProductionRefusal("Nilai harus rupiah utuh, tidak negatif.");
  const item = await productionItem(tx, e.itemId);
  await activeWorkstation(tx, e.workstationId);
  const lotNo = String(e.lotNo ?? "").trim().toUpperCase();
  if (!lotNo) throw new ProductionRefusal(`${item.item_label} dikelola per lot: isi No. Lot.`);
  if (item.has_expiry && !e.expiry) throw new ProductionRefusal(`${item.item_label} memiliki kadaluarsa: lot ${lotNo} tanpa tanggal kadaluarsa.`);

  let lot = await tx.prdLot.findUnique({ where: { item_id_lot_no: { item_id: e.itemId, lot_no: lotNo } } });
  if (lot) {
    if ((lot.batch_id ?? null) !== (e.batch?.id ?? null) && e.batch) {
      if (lot.batch_id) throw new ProductionRefusal(`Lot ${lotNo} ${item.item_label} sudah tercatat dengan batch lain.`);
      lot = await tx.prdLot.update({ where: { id: lot.id }, data: { batch_id: e.batch.id } });
    }
    if (e.expiry && iso(lot.expiry_date) !== iso(e.expiry)) {
      throw new ProductionRefusal(`Lot ${lotNo} ${item.item_label} sudah tercatat dengan kadaluarsa ${iso(lot.expiry_date) ?? "kosong"}.`);
    }
  } else {
    lot = await tx.prdLot.create({
      data: {
        item_id: e.itemId,
        lot_no: lotNo,
        batch_id: e.batch?.id ?? null,
        expiry_date: e.expiry,
        origin: "Issued",
        source_doc_type_id: e.source.docTypeId,
        source_doc_id: e.source.docId,
        source_no: e.source.no,
        created_by: e.actorId,
      },
    });
  }
  const bucket = await openBucket(tx, { lotId: lot.id, workstationId: e.workstationId, itemId: e.itemId, uomId: item.base_uom_id }, e.actorId);
  await write(tx, bucket, { movement: "Issued", qty, value, date: e.date, source: e.source, actorId: e.actorId });
  return { lotId: lot.id, bucketId: bucket.id };
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
  batch: BatchRef | null;
};

/**
 * Takes goods out of production (Penerimaan Hasil Produksi, Pemusnahan): the
 * bucket releases round(V × q ÷ Q), or V whole when q empties it. Refuses
 * short quantity. Says what the goods were — lot, expiry and batch — so the
 * caller can carry them into stock.
 */
export async function takeFromBucket(tx: Tx, t: ProductionTake): Promise<TakenFromProduction> {
  const b = await lockBucketById(tx, t.bucketId);
  if (!b) throw new ProductionRefusal("Saldo produksi tidak ditemukan. Pilih ulang.");
  const value = await takeLocked(tx, b, new D(t.baseQty), "Released", t.date, t.source, t.actorId);
  const lot = await tx.prdLot.findUniqueOrThrow({ where: { id: b.lotId }, select: { lot_no: true, expiry_date: true } });
  return {
    value: value.toNumber(),
    lotId: b.lotId,
    lotNo: lot.lot_no,
    itemId: b.itemId,
    workstationId: b.workstationId,
    expiry: lot.expiry_date,
    batch: await lotBatch(tx, b.lotId),
  };
}

// ------------------------------------------------------------ producing

export type ProduceInput = { bucketId: number; baseQty: number | string };

export type ProduceOutput = {
  itemId: number;
  /** A new lot number for the item (M42). */
  lotNo: string;
  expiry: Date | null;
  baseQty: number | string;
  /** Bobot Biaya (M13); 0 carries no value. */
  weight: number;
};

export type Production = {
  workstationId: number;
  inputs: ProduceInput[];
  outputs: ProduceOutput[];
  /** The execution's standard conversion, whole rupiah (P155 M92); 0 without a standard. */
  addedValue?: number;
  /** *Batch Baru* (M41). */
  newBatch: boolean;
  /** The number a new batch takes; generated `BT/YYYY/MM/NNNN` when empty (M42). */
  batchNo?: string | null;
  /** Information only (M48), for a batch that starts here. */
  customerOrder?: { id: number; no: string } | null;
  date: Date;
  source: ProductionSource;
  actorId: number;
};

export type Produced = {
  /** Per input, in the order given: what it released. */
  inputs: { bucketId: number; lotId: number; itemId: number; value: number }[];
  /** Per output, in the order given: its lot, bucket and value. */
  outputs: { lotId: number; bucketId: number; value: number }[];
  /** Σ input value + added value = Σ output value. */
  total: number;
  batch: BatchRef;
  batchStarted: boolean;
};

/**
 * One execution, balanced (M12): takes every input, shares Σ input value plus
 * the added value over the outputs by Bobot Biaya (largest remainder), creates
 * each output lot and its bucket at the execution's workstation, and records
 * the genealogy. The batch follows M41. Called inside the execution's posting.
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
    if (seen.has(`${o.itemId}:${lotNo}`)) throw new ProductionRefusal(`Lot ${lotNo} ${item.item_label} dipakai dua kali.`);
    seen.add(`${o.itemId}:${lotNo}`);
    if (await tx.prdLot.findUnique({ where: { item_id_lot_no: { item_id: o.itemId, lot_no: lotNo } }, select: { id: true } })) {
      throw new ProductionRefusal(`Lot ${lotNo} ${item.item_label} sudah pernah dipakai; lot output selalu baru.`);
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

  // The batch (M41).
  const inputBatches = await Promise.all(inputs.map((i) => lotBatch(tx, i.lotId)));
  const outcome = batchOutcome(inputBatches, p.newBatch);
  if (outcome.kind === "mixed") {
    throw new ProductionRefusal(`Input berasal dari batch ${outcome.batches.map((b) => b.no).join(" dan ")}; aktifkan Batch Baru untuk menggabungkannya.`);
  }
  let batch: BatchRef;
  let batchStarted = false;
  if (outcome.kind === "carried") batch = outcome.batch;
  else {
    batch = await startBatch(tx, { no: p.batchNo, date: p.date, source: p.source, parents: outcome.parents, customerOrder: p.customerOrder, actorId: p.actorId });
    batchStarted = true;
  }

  // The outputs, at Σ input + added, shared by Bobot Biaya.
  const total = inputs.reduce((a, i) => a + i.value, 0) + added;
  const values = shareByWeight(total, weights);
  const outputs: Produced["outputs"] = [];
  for (const [j, o] of outs.entries()) {
    const lot = await tx.prdLot.create({
      data: {
        item_id: o.itemId,
        lot_no: o.lotNo,
        batch_id: batch.id,
        expiry_date: o.expiry,
        origin: "Produced",
        source_doc_type_id: p.source.docTypeId,
        source_doc_id: p.source.docId,
        source_no: p.source.no,
        created_by: p.actorId,
      },
    });
    const bucket = await openBucket(tx, { lotId: lot.id, workstationId: p.workstationId, itemId: o.itemId, uomId: o.item.base_uom_id }, p.actorId);
    await write(tx, bucket, { movement: "Produced", qty: o.qty, value: new D(values[j]), date: p.date, source: p.source, actorId: p.actorId });
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
  return { inputs, outputs, total, batch, batchStarted };
}

/**
 * Starts a batch (E3): the number typed, or the next `BT/YYYY/MM/NNNN`;
 * unique. *Batch Baru* over batched inputs names each of their batches as a
 * parent (M41).
 */
async function startBatch(
  tx: Tx,
  s: { no?: string | null; date: Date; source: ProductionSource; parents: BatchRef[]; customerOrder?: { id: number; no: string } | null; actorId: number }
): Promise<BatchRef> {
  const typed = String(s.no ?? "").trim().toUpperCase();
  const no =
    typed ||
    (await nextDocumentNumber("BT", s.date, async (series) => {
      const row = await tx.prdBatch.findFirst({ where: { batch_no: { startsWith: series } }, orderBy: { batch_no: "desc" }, select: { batch_no: true } });
      return row?.batch_no ?? null;
    }));
  if (await tx.prdBatch.findUnique({ where: { batch_no: no }, select: { id: true } })) throw new ProductionRefusal(`Nomor batch ${no} sudah dipakai.`);
  const row = await tx.prdBatch.create({
    data: {
      batch_no: no,
      batch_date: s.date,
      source_doc_type_id: s.source.docTypeId,
      source_doc_id: s.source.docId,
      source_no: s.source.no,
      customer_order_id: s.customerOrder?.id ?? null,
      customer_order_no: s.customerOrder?.no ?? null,
      created_by: s.actorId,
    },
  });
  for (const parent of s.parents) await tx.prdBatchParent.create({ data: { batch_id: row.id, parent_batch_id: parent.id } });
  return { id: row.id, no: row.batch_no };
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
  batchId: number | null;
  batchNo: string | null;
  expiry: string | null;
  qty: number;
  value: number;
};

const bucketInclude = {
  lot: { select: { lot_no: true, expiry_date: true, batch: { select: { id: true, batch_no: true } } } },
  item: { select: { item_label: true, item_name: true } },
  workstation: { select: { workstation_label: true } },
} as const;

type BucketRow = Prisma.PrdBalanceGetPayload<{ include: typeof bucketInclude }>;

const view = (b: BucketRow): BucketView => ({
  id: b.id,
  lotId: b.lot_id,
  lotNo: b.lot.lot_no,
  itemId: b.item_id,
  itemLabel: b.item.item_label,
  itemName: b.item.item_name,
  workstationId: b.workstation_id,
  workstationLabel: b.workstation.workstation_label,
  batchId: b.lot.batch?.id ?? null,
  batchNo: b.lot.batch?.batch_no ?? null,
  expiry: iso(b.lot.expiry_date),
  qty: b.qty_balance.toNumber(),
  value: b.value_balance.toNumber(),
});

/**
 * Every bucket holding quantity, for the pickers of executions, receipts and
 * scrap (pull, M2) — filtered by workstation, item or batch; earliest expiry
 * first, then lot. `withIds` brings in buckets a stored document names,
 * whatever they hold now.
 */
export async function availableBuckets(
  filter: { workstationIds?: number[]; itemIds?: number[]; batchIds?: number[]; withIds?: number[] } = {},
  db: Db = prisma
): Promise<BucketView[]> {
  const rows = await db.prdBalance.findMany({
    where: {
      OR: [
        {
          qty_balance: { gt: 0 },
          ...(filter.workstationIds?.length ? { workstation_id: { in: filter.workstationIds } } : {}),
          ...(filter.itemIds?.length ? { item_id: { in: filter.itemIds } } : {}),
          ...(filter.batchIds?.length ? { lot: { batch_id: { in: filter.batchIds } } } : {}),
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

/** Σ value held in production now, per item — what the WIP accounts should hold. */
export async function wipByItem(db: Db = prisma): Promise<Map<number, number>> {
  const rows = await db.prdBalance.groupBy({ by: ["item_id"], _sum: { value_balance: true }, where: { value_balance: { not: 0 } } });
  return new Map(rows.map((r) => [r.item_id, r._sum.value_balance?.toNumber() ?? 0]));
}
