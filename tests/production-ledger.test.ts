import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { outputWeight, shareByWeight, shareQty } from "../src/lib/erp/production-execution";
import { ProductionRefusal, availableBuckets, enterProduction, produce, revalueBucket, takeFromBucket, transferBucket } from "../src/lib/erp/production-ledger";
import { cleanupFixtures, disconnect, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * The production ledger (R3, R5–R7): buckets per lot · workstation, release at
 * round(V × q ÷ Q), transfers at the value released, executions shared by
 * qty × Bobot Nilai into new lots, and the balances always equal the ledger.
 */

let f: ProductionFixture;
let productLot = 0;
const date = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const tx = <T>(fn: (t: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) => prisma.$transaction(fn);
const bucketOf = async (lotId: number, ws: number) => prisma.prdBalance.findUniqueOrThrow({ where: { tracking_id_workstation_id: { tracking_id: lotId, workstation_id: ws } } });

before(async () => {
  f = await makeProductionFixture("LED");
});

after(async () => {
  await f.teardown();
  await cleanupFixtures();
  await disconnect();
});

describe("the arithmetic (R6)", () => {
  test("a value shares by weight to the rupiah, largest remainder", () => {
    assert.deepEqual(shareByWeight(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(shareByWeight(1_000, [3, 0, 1]), [750, 0, 250]);
    assert.equal(shareByWeight(999_999, [0.7, 0.2, 0.1]).reduce((a, b) => a + b, 0), 999_999);
    assert.deepEqual(shareQty(10, [1, 2]), [3.333333, 6.666667]);
  });

  test("an output's weight is qty × Bobot Nilai; empty weighs nothing", () => {
    assert.equal(outputWeight(500, 2), 1_000);
    assert.equal(outputWeight(500, null), 0);
    assert.equal(outputWeight(0, 3), 0);
  });
});

describe("goods in, through and out of production", () => {
  test("a stock lot enters a workstation at the value it left stock at", async () => {
    const s = await sourceOf("log_stock_issue", "SI-T1");
    await tx(async (t) => {
      const { cost } = await issueStock(t, { itemId: f.material, warehouseId: f.warehouse, lotId: f.lot, baseQty: 400, date, source: s, actorId: f.actor });
      assert.equal(cost, 400_000);
      await enterProduction(t, { lotId: f.lot, itemId: f.material, workstationId: f.wsA, baseQty: 400, value: cost, date, source: s, actorId: f.actor });
    });
    const b = await bucketOf(f.lot, f.wsA);
    assert.deepEqual([b.qty_balance.toNumber(), b.value_balance.toNumber()], [400, 400_000]);
  });

  test("a transfer moves the lot and its released value to another station", async () => {
    const s = await sourceOf("prd_transfer", "PT-T1");
    const from = await bucketOf(f.lot, f.wsA);
    const r = await tx((t) => transferBucket(t, { bucketId: from.id, toWorkstationId: f.wsB, baseQty: 100, date, source: s, actorId: f.actor }));
    assert.equal(r.value, 100_000);
    assert.equal((await bucketOf(f.lot, f.wsB)).value_balance.toNumber(), 100_000);
    assert.equal((await bucketOf(f.lot, f.wsA)).value_balance.toNumber(), 300_000);
  });

  test("an execution consumes inputs and makes new lots valued by qty × Bobot Nilai", async () => {
    const s = await sourceOf("prd_execution", "EX-T1");
    const input = await bucketOf(f.lot, f.wsA);
    const r = await tx((t) =>
      produce(t, {
        workstationId: f.wsA,
        inputs: [{ bucketId: input.id, baseQty: 300 }],
        outputs: [
          { itemId: f.product, lotNo: f.key("P1"), expiry: null, baseQty: 250 },
          { itemId: f.byproduct, lotNo: f.key("S1"), expiry: null, baseQty: 40 },
        ],
        date,
        source: s,
        actorId: f.actor,
      })
    );
    assert.equal(r.total, 300_000);
    assert.deepEqual(r.outputs.map((o) => o.value), [300_000, 0], "the by-product without Bobot Nilai takes nothing");
    const lot = await prisma.logStockTracking.findUniqueOrThrow({ where: { id: r.outputs[0].lotId } });
    assert.equal(lot.tracking_no, f.key("P1"));
    assert.equal((await prisma.prdTrackingLink.findMany({ where: { to_tracking_id: r.outputs[0].lotId } })).length, 1);
    productLot = r.outputs[0].lotId;
  });

  test("an output lot number the item already has is refused, and so are outputs all weighing 0", async () => {
    const s = await sourceOf("prd_execution", "EX-T2");
    const input = await bucketOf(f.lot, f.wsB);
    await assert.rejects(
      tx((t) => produce(t, { workstationId: f.wsB, inputs: [{ bucketId: input.id, baseQty: 10 }], outputs: [{ itemId: f.product, lotNo: f.key("P1"), expiry: null, baseQty: 5 }], date, source: s, actorId: f.actor })),
      (e) => e instanceof ProductionRefusal && /sudah ada/.test(e.message)
    );
    await assert.rejects(
      tx((t) => produce(t, { workstationId: f.wsB, inputs: [{ bucketId: input.id, baseQty: 10 }], outputs: [{ itemId: f.byproduct, lotNo: f.key("S9"), expiry: null, baseQty: 5 }], date, source: s, actorId: f.actor })),
      (e) => e instanceof ProductionRefusal && /berbobot 0/.test(e.message)
    );
    await assert.rejects(
      tx((t) => produce(t, { workstationId: f.wsA, inputs: [{ bucketId: input.id, baseQty: 10 }], outputs: [{ itemId: f.product, lotNo: f.key("P8"), expiry: null, baseQty: 5 }], date, source: s, actorId: f.actor })),
      (e) => e instanceof ProductionRefusal && /workstation eksekusi/.test(e.message),
      "an input must be held at the executing station"
    );
  });

  test("taking more than a bucket holds is refused; emptying it releases V whole", async () => {
    const s = await sourceOf("prd_release", "RL-T1");
    const b = await bucketOf(productLot, f.wsA);
    await assert.rejects(tx((t) => takeFromBucket(t, { bucketId: b.id, baseQty: 251, date, source: s, actorId: f.actor })), /tidak cukup/);
    const part = await tx((t) => takeFromBucket(t, { bucketId: b.id, baseQty: 83, date, source: s, actorId: f.actor }));
    assert.equal(part.value, 99_600);
    const rest = await tx((t) => takeFromBucket(t, { bucketId: b.id, baseQty: 167, date, source: s, actorId: f.actor }));
    assert.equal(rest.value, 200_400);
    const after = await bucketOf(productLot, f.wsA);
    assert.deepEqual([after.qty_balance.toNumber(), after.value_balance.toNumber()], [0, 0]);
  });

  test("revaluing adds value at quantity 0, only to a bucket that holds goods", async () => {
    const s = await sourceOf("prd_execution", "CL-T1");
    const b = await bucketOf(f.lot, f.wsB);
    await tx((t) => revalueBucket(t, { bucketId: b.id, value: 1_234, date, source: s, actorId: f.actor }));
    assert.equal((await bucketOf(f.lot, f.wsB)).value_balance.toNumber(), 101_234);
    const empty = await bucketOf(productLot, f.wsA);
    await assert.rejects(tx((t) => revalueBucket(t, { bucketId: empty.id, value: 1, date, source: s, actorId: f.actor })), /kosong/);
  });

  test("each bucket equals its ledger rows, and the pickers list what is held", async () => {
    const buckets = await prisma.prdBalance.findMany({ where: { item_id: { in: [f.material, f.product, f.byproduct] } } });
    for (const b of buckets) {
      const rows = await prisma.prdLedger.findMany({ where: { bucket_id: b.id }, orderBy: { id: "asc" } });
      assert.equal(rows.reduce((a, r) => a + r.qty_change.toNumber(), 0), b.qty_balance.toNumber());
      assert.equal(rows.reduce((a, r) => a + r.value_change.toNumber(), 0), b.value_balance.toNumber());
      assert.equal(rows.at(-1)!.value_balance.toNumber(), b.value_balance.toNumber());
    }
    const held = await availableBuckets({ workstationIds: [f.wsA, f.wsB] });
    assert.ok(held.every((b) => b.qty > 0));
    assert.ok(held.some((b) => b.itemId === f.byproduct && b.value === 0), "an output without value is still held");
  });
});
