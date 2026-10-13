import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { ProductionRefusal, availableBuckets, enterProduction, produce, revalueBucket, takeFromBucket, wipByItem, type Production } from "../src/lib/erp/production-ledger";
import { batchOutcome, shareByWeight, shareQty } from "../src/lib/erp/production-execution";
import { FIXTURE_PREFIX, disconnect, prisma, systemUserId } from "./helpers";

/**
 * The production ledger (P150 E2, E3; P155 M92): buckets of one lot at one
 * workstation holding Q and V, never pooled; a take releases round(V × q ÷ Q)
 * and the emptying one V whole; an execution is balanced — Σ input value plus
 * its standard conversion shared over the outputs by Bobot Biaya — and writes
 * the genealogy and the batch (M41, M42); a revaluation moves value only.
 */

let actor = 0;
const f = {} as Record<string, number>;
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
let docTypeId = 0;
let docSeq = 800_000 + Number(stamp) * 10;
const src = () => ({ docTypeId, docId: ++docSeq, no: key(`SRC${docSeq}`) });
const items: number[] = [];
const batches = new Set<number>();

before(async () => {
  actor = await systemUserId();
  f.kg = (await prisma.refUom.create({ data: { uom_code: `test.${key("KG")}`, uom_label: key("KG"), uom_name: "Kg", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const item = async (l: string, track = true, expiry = false) => {
    const id = (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: cat, base_uom_id: f.kg, track_stock: track, has_expiry: expiry, created_by: actor },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.rm = await item("RM");
  f.pk = await item("PK");
  f.bulk = await item("BULK");
  f.fg = await item("FG");
  f.reject = await item("REJ");
  f.exp = await item("EXP", true, true);
  f.plain = await item("PLAIN", false);
  const ws = async (l: string, active = true) =>
    (
      await prisma.refWorkstation.create({
        data: { workstation_code: `test.${key(l)}`, workstation_label: key(l), workstation_name: l, status: active ? "Active" : "Inactive", created_by: actor },
      })
    ).id;
  f.ws1 = await ws("WS1");
  f.ws2 = await ws("WS2");
  f.wsOff = await ws("WSOFF", false);
  docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "log_stock_injection" } })).id;
});

after(async () => {
  const lots = (await prisma.prdLot.findMany({ where: { item_id: { in: items } }, select: { id: true, batch_id: true } }));
  for (const l of lots) if (l.batch_id) batches.add(l.batch_id);
  await prisma.prdLotLink.deleteMany({ where: { OR: [{ from_lot_id: { in: lots.map((l) => l.id) } }, { to_lot_id: { in: lots.map((l) => l.id) } }] } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdLot.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBatchParent.deleteMany({ where: { batch_id: { in: [...batches] } } });
  await prisma.prdBatch.deleteMany({ where: { id: { in: [...batches] } } });
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: { in: [f.ws1, f.ws2, f.wsOff] } } });
  await prisma.refUom.deleteMany({ where: { id: f.kg } });
  await disconnect();
});

const enter = (itemId: number, lotNo: string, qty: number, value: number, ws = f.ws1, extra: { expiry?: string; batch?: { id: number; no: string } } = {}) =>
  prisma.$transaction((tx) =>
    enterProduction(tx, {
      itemId,
      lotNo,
      expiry: extra.expiry ? day(extra.expiry) : null,
      batch: extra.batch ?? null,
      workstationId: ws,
      baseQty: qty,
      value,
      date: day("2026-10-05"),
      source: src(),
      actorId: actor,
    })
  );

const run = (p: Omit<Production, "date" | "source" | "actorId" | "newBatch"> & { newBatch?: boolean }) =>
  prisma.$transaction((tx) => produce(tx, { newBatch: false, ...p, date: day("2026-10-06"), source: src(), actorId: actor }));

const bucket = async (id: number) => {
  const b = await prisma.prdBalance.findUniqueOrThrow({ where: { id } });
  return [b.qty_balance.toNumber(), b.value_balance.toNumber()];
};

describe("the execution arithmetic is pure (E6)", () => {
  test("a value is shared by weight in whole rupiah, largest remainder, adding up exactly", () => {
    assert.deepEqual(shareByWeight(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(shareByWeight(10_000_000, [850, 50, 0]), [9_444_444, 555_556, 0], "the larger remainder (0,56) takes the rupiah");
    assert.deepEqual(shareByWeight(-100, [1, 1, 1]), [-34, -33, -33]);
    assert.deepEqual(shareByWeight(7, [0.5, 0.25, 0.25]), [3, 2, 2]);
    assert.deepEqual(shareByWeight(0, [0, 0]), [0, 0]);
    assert.throws(() => shareByWeight(5, [0, 0]));
  });

  test("a quantity is shared at six decimals, the last weighted part taking the rounding", () => {
    const parts = shareQty(10, [1, 1, 1]);
    assert.equal(parts.reduce((a, p) => a + p, 0), 10);
    assert.deepEqual(shareQty(5, [2, 0]), [5, 0]);
  });

  test("the batch rule (M41)", () => {
    const a = { id: 1, no: "BT/A" };
    const b = { id: 2, no: "BT/B" };
    assert.deepEqual(batchOutcome([null, null], false), { kind: "new", parents: [] });
    assert.deepEqual(batchOutcome([a, null, a], false), { kind: "carried", batch: a });
    assert.deepEqual(batchOutcome([b, a], false), { kind: "mixed", batches: [a, b] });
    assert.deepEqual(batchOutcome([b, a], true), { kind: "new", parents: [a, b] });
    assert.deepEqual(batchOutcome([a], true), { kind: "new", parents: [a] });
  });
});

describe("goods enter production at their issue value (§9.3)", () => {
  test("a stock lot keeps its number; issuing it again adds to its bucket; another workstation is another bucket", async () => {
    const one = await enter(f.rm, key("rm-1"), 1_100, 11_000_000);
    const again = await enter(f.rm, key("RM-1"), 100, 1_200_000);
    assert.equal(again.bucketId, one.bucketId, "the same lot at the same workstation");
    assert.deepEqual(await bucket(one.bucketId), [1_200, 12_200_000]);
    const elsewhere = await enter(f.rm, key("RM-1"), 50, 500_000, f.ws2);
    assert.notEqual(elsewhere.bucketId, one.bucketId);
    assert.equal(elsewhere.lotId, one.lotId, "one production lot, two buckets (X17)");
    const lot = await prisma.prdLot.findUniqueOrThrow({ where: { id: one.lotId } });
    assert.equal(lot.lot_no, key("RM-1"));
    assert.equal(lot.origin, "Issued");
    f.rmBucket = one.bucketId;
    f.rmBucket2 = elsewhere.bucketId;
  });

  test("an item without Kelola Stok, an inactive workstation, a missing expiry are refused", async () => {
    await assert.rejects(enter(f.plain, key("P-1"), 1, 1), ProductionRefusal);
    await assert.rejects(enter(f.rm, key("RM-9"), 1, 1, f.wsOff), /nonaktif/);
    await assert.rejects(enter(f.exp, key("E-1"), 1, 1), /kadaluarsa/);
    await assert.rejects(enter(f.rm, key("RM-9"), 1, 1.5), /rupiah utuh/);
  });

  test("the ledger keeps one number per posting, a line per movement, with the balances after it", async () => {
    const rows = await prisma.prdLedger.findMany({ where: { bucket_id: f.rmBucket }, orderBy: { id: "asc" } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => /^MP\/\d{4}\/\d{2}\/\d{4}$/.test(r.ledger_no) && r.line_no === 1 && r.movement === "Issued"));
    assert.notEqual(rows[0].ledger_no, rows[1].ledger_no);
    assert.deepEqual([rows[1].qty_balance.toNumber(), rows[1].value_balance.toNumber()], [1_200, 12_200_000]);
  });
});

describe("an execution is balanced: cost in = cost out (G3, M12, M13)", () => {
  test("inputs taken at round(V × q ÷ Q); Σ value shared by Bobot Biaya; a reject at 0 takes none; a new batch starts", async () => {
    const r = await run({
      workstationId: f.ws1,
      inputs: [{ bucketId: f.rmBucket, baseQty: 1_000 }],
      outputs: [
        { itemId: f.bulk, lotNo: key("blk-1"), expiry: null, baseQty: 850, weight: 850 },
        { itemId: f.reject, lotNo: key("rej-1"), expiry: null, baseQty: 50, weight: 0 },
      ],
    });
    // 12.200.000 × 1.000 ÷ 1.200 = 10.166.666,67 → 10.166.667
    assert.deepEqual(r.inputs.map((i) => i.value), [10_166_667]);
    assert.deepEqual(r.outputs.map((o) => o.value), [10_166_667, 0]);
    assert.equal(r.total, 10_166_667);
    assert.equal(r.batchStarted, true);
    assert.match(r.batch.no, /^BT\/\d{4}\/\d{2}\/\d{4}$/);
    batches.add(r.batch.id);
    assert.deepEqual(await bucket(f.rmBucket), [200, 2_033_333]);
    assert.deepEqual(await bucket(r.outputs[0].bucketId), [850, 10_166_667]);
    f.bulkBucket = r.outputs[0].bucketId;
    f.rejectBucket = r.outputs[1].bucketId;
    f.batch1 = r.batch.id;
    const links = await prisma.prdLotLink.findMany({ where: { to_lot_id: r.outputs[0].lotId } });
    assert.deepEqual(links.map((l) => [l.qty.toNumber(), l.value.toNumber()]), [[1_000, 10_166_667]], "the reject takes no edge");
    const lot = await prisma.prdLot.findUniqueOrThrow({ where: { id: r.outputs[0].lotId } });
    assert.deepEqual([lot.origin, lot.batch_id], ["Produced", r.batch.id]);
  });

  test("the standard conversion is added to the value out (P155 M92); one batch among the inputs is carried, packaging joining it", async () => {
    const pk = await enter(f.pk, key("pk-1"), 1_000, 1_500_000, f.ws2);
    const r = await run({
      workstationId: f.ws2,
      inputs: [
        { bucketId: f.bulkBucket, baseQty: 425 },
        { bucketId: pk.bucketId, baseQty: 500 },
      ],
      outputs: [{ itemId: f.fg, lotNo: key("fg-1"), expiry: null, baseQty: 500, weight: 1 }],
      addedValue: 1_200_000,
    });
    // half the bulk (5.083.334 by round(10.166.667 × 425 ÷ 850)) + half the packaging + 1.200.000
    assert.deepEqual(r.inputs.map((i) => i.value), [5_083_334, 750_000]);
    assert.equal(r.total, 5_083_334 + 750_000 + 1_200_000);
    assert.deepEqual(r.outputs.map((o) => o.value), [r.total]);
    assert.equal(r.batchStarted, false);
    assert.equal(r.batch.id, f.batch1, "the bulk's batch is carried");
    f.fgBucket = r.outputs[0].bucketId;
    const edges = await prisma.prdLotLink.findMany({ where: { to_lot_id: r.outputs[0].lotId } });
    assert.equal(edges.reduce((a, e) => a + e.value.toNumber(), 0), 5_083_334 + 750_000, "edges carry the inputs' value; the conversion has no input");
  });

  test("the emptying take releases what is left; two batches are refused unless Batch Baru, which names both as parents", async () => {
    const other = await run({
      workstationId: f.ws2,
      inputs: [{ bucketId: f.rmBucket2, baseQty: 50 }],
      outputs: [{ itemId: f.bulk, lotNo: key("blk-2"), expiry: null, baseQty: 48, weight: 1 }],
      batchNo: key("bt-own"),
    });
    batches.add(other.batch.id);
    assert.equal(other.batch.no, key("BT-OWN"), "a typed batch number is kept");
    const mixed = {
      workstationId: f.ws2,
      inputs: [
        { bucketId: f.bulkBucket, baseQty: 425 },
        { bucketId: other.outputs[0].bucketId, baseQty: 48 },
      ],
      outputs: [{ itemId: f.fg, lotNo: key("fg-2"), expiry: null, baseQty: 470, weight: 1 }],
    };
    await assert.rejects(run(mixed), /Batch Baru/);
    assert.deepEqual(await bucket(f.bulkBucket), [425, 5_083_333], "a refused execution writes nothing");
    const merged = await run({ ...mixed, newBatch: true });
    batches.add(merged.batch.id);
    assert.equal(merged.inputs[0].value, 5_083_333, "the take that empties the bucket releases V whole");
    assert.deepEqual(await bucket(f.bulkBucket), [0, 0]);
    const parents = await prisma.prdBatchParent.findMany({ where: { batch_id: merged.batch.id }, orderBy: { parent_batch_id: "asc" } });
    assert.deepEqual(parents.map((p) => p.parent_batch_id), [f.batch1, other.batch.id].sort((a, b) => a - b));
  });

  test("an output lot number is always new (M42); short input, no output, zero weights are refused", async () => {
    const base = { workstationId: f.ws1, inputs: [{ bucketId: f.rmBucket, baseQty: 10 }] };
    await assert.rejects(run({ ...base, outputs: [{ itemId: f.fg, lotNo: key("FG-1"), expiry: null, baseQty: 1, weight: 1 }] }), /sudah pernah dipakai/);
    await assert.rejects(run({ ...base, outputs: [] }), /minimal satu output/);
    await assert.rejects(run({ ...base, outputs: [{ itemId: f.fg, lotNo: key("fg-9"), expiry: null, baseQty: 1, weight: 0 }] }), /Bobot Biaya/);
    await assert.rejects(
      run({ workstationId: f.ws1, inputs: [{ bucketId: f.rmBucket, baseQty: 201 }], outputs: [{ itemId: f.fg, lotNo: key("fg-9"), expiry: null, baseQty: 1, weight: 1 }] }),
      /tidak cukup: tersedia 200, diminta 201/
    );
    assert.deepEqual(await bucket(f.rmBucket), [200, 2_033_333]);
  });
});

describe("goods leave production at their bucket's value; the close revalues by value only", () => {
  test("a take says what the goods were — lot, batch — and releases its share", async () => {
    const t = await prisma.$transaction((tx) => takeFromBucket(tx, { bucketId: f.fgBucket, baseQty: 100, date: day("2026-10-07"), source: src(), actorId: actor }));
    const [qty, value] = await bucket(f.fgBucket);
    assert.equal(qty, 400);
    assert.equal(t.value + value, 7_033_334);
    assert.equal(t.value, Math.round((7_033_334 * 100) / 500));
    assert.equal(t.lotNo, key("FG-1"));
    assert.equal(t.batch?.id, f.batch1);
  });

  test("a revaluation changes value with quantity 0; an empty bucket or a negative result is refused", async () => {
    const before = await bucket(f.fgBucket);
    await prisma.$transaction((tx) => revalueBucket(tx, { bucketId: f.fgBucket, value: 12_345, date: day("2026-10-31"), source: src(), actorId: actor }));
    assert.deepEqual(await bucket(f.fgBucket), [before[0], before[1] + 12_345]);
    const row = await prisma.prdLedger.findFirstOrThrow({ where: { bucket_id: f.fgBucket, movement: "Revalued" } });
    assert.equal(row.qty_change.toNumber(), 0);
    await assert.rejects(prisma.$transaction((tx) => revalueBucket(tx, { bucketId: f.bulkBucket, value: 1, date: day("2026-10-31"), source: src(), actorId: actor })), /kosong/);
    await assert.rejects(prisma.$transaction((tx) => revalueBucket(tx, { bucketId: f.fgBucket, value: -1e10, date: day("2026-10-31"), source: src(), actorId: actor })), /negatif/);
  });

  test("each bucket equals its ledger; the pickers list what holds quantity; WIP per item is Σ bucket value", async () => {
    const buckets = await prisma.prdBalance.findMany({ where: { item_id: { in: items } } });
    for (const b of buckets) {
      const sum = await prisma.prdLedger.aggregate({ where: { bucket_id: b.id }, _sum: { qty_change: true, value_change: true } });
      assert.equal(sum._sum.qty_change?.toNumber() ?? 0, b.qty_balance.toNumber());
      assert.equal(sum._sum.value_change?.toNumber() ?? 0, b.value_balance.toNumber());
    }
    const open = await availableBuckets({ itemIds: items });
    assert.ok(open.every((b) => b.qty > 0));
    assert.ok(open.some((b) => b.id === f.rejectBucket && b.value === 0), "a reject waits in production at 0 (M59)");
    assert.ok(!open.some((b) => b.id === f.bulkBucket), "an emptied bucket is not offered");
    assert.ok((await availableBuckets({ withIds: [f.bulkBucket] })).some((b) => b.id === f.bulkBucket), "unless a stored document names it");
    const wip = await wipByItem();
    const fgValue = buckets.filter((b) => b.item_id === f.fg).reduce((a, b) => a + b.value_balance.toNumber(), 0);
    assert.equal(wip.get(f.fg), fgValue);
  });
});
