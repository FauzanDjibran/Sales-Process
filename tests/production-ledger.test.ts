import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { shareByWeight, shareQty } from "../src/lib/erp/production-execution";
import { availableBuckets, enterProduction, takeFromBucket, transferBucket } from "../src/lib/erp/production-ledger";
import { cleanupFixtures, disconnect, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * The production ledger (R3, R7): buckets per lot · workstation, release at
 * round(V × q ÷ Q), transfers at the value released, and the balances always
 * equal the ledger.
 */

let f: ProductionFixture;
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

describe("the sharing arithmetic", () => {
  test("a value shares by weight to the rupiah, largest remainder", () => {
    assert.deepEqual(shareByWeight(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(shareByWeight(1_000, [3, 0, 1]), [750, 0, 250]);
    assert.equal(shareByWeight(999_999, [0.7, 0.2, 0.1]).reduce((a, b) => a + b, 0), 999_999);
    assert.deepEqual(shareQty(10, [1, 2]), [3.333333, 6.666667]);
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
    const s = await sourceOf("log_stock_issue", "PT-T1");
    const from = await bucketOf(f.lot, f.wsA);
    const r = await tx((t) => transferBucket(t, { bucketId: from.id, toWorkstationId: f.wsB, baseQty: 100, date, source: s, actorId: f.actor }));
    assert.equal(r.value, 100_000);
    assert.equal((await bucketOf(f.lot, f.wsB)).value_balance.toNumber(), 100_000);
    assert.equal((await bucketOf(f.lot, f.wsA)).value_balance.toNumber(), 300_000);
  });

  test("taking more than a bucket holds is refused; emptying it releases V whole", async () => {
    const s = await sourceOf("log_stock_issue", "RL-T1");
    const b = await bucketOf(f.lot, f.wsB);
    await assert.rejects(tx((t) => takeFromBucket(t, { bucketId: b.id, baseQty: 101, date, source: s, actorId: f.actor })), /tidak cukup/);
    const part = await tx((t) => takeFromBucket(t, { bucketId: b.id, baseQty: 33, date, source: s, actorId: f.actor }));
    assert.equal(part.value, 33_000);
    const rest = await tx((t) => takeFromBucket(t, { bucketId: b.id, baseQty: 67, date, source: s, actorId: f.actor }));
    assert.equal(rest.value, 67_000);
    const after = await bucketOf(f.lot, f.wsB);
    assert.deepEqual([after.qty_balance.toNumber(), after.value_balance.toNumber()], [0, 0]);
  });

  test("each bucket equals its ledger rows, and the pickers list what is held", async () => {
    const buckets = await prisma.prdBalance.findMany({ where: { item_id: f.material } });
    for (const b of buckets) {
      const rows = await prisma.prdLedger.findMany({ where: { bucket_id: b.id }, orderBy: { id: "asc" } });
      assert.equal(rows.reduce((a, r) => a + r.qty_change.toNumber(), 0), b.qty_balance.toNumber());
      assert.equal(rows.reduce((a, r) => a + r.value_change.toNumber(), 0), b.value_balance.toNumber());
      assert.equal(rows.at(-1)!.value_balance.toNumber(), b.value_balance.toNumber());
    }
    const held = await availableBuckets({ workstationIds: [f.wsA, f.wsB] });
    assert.ok(held.every((b) => b.qty > 0));
    assert.deepEqual(held.map((b) => [b.workstationId, b.qty, b.value]), [[f.wsA, 300, 300_000]], "a bucket emptied is no longer offered");
  });
});
