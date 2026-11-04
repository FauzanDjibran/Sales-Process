import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { dailySeries, nextDailyNumber } from "../src/lib/erp/document-number";
import { checkRoutingCollections } from "../src/lib/erp/production-master";
import { STEPS_KEY } from "../src/lib/erp/production-master-shape";
import {
  advanceToStandBy,
  availableBuckets,
  enterProduction,
  formPartai,
  issueJob,
  recordCostEntry,
  recordTrackingInfo,
  transferBucket,
} from "../src/lib/erp/production-ledger";
import { cleanupFixtures, disconnect, prisma } from "./helpers";
import { cleanupProduction, makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * The identities of production (P227): a bucket is No. Stok · Unit · stage ·
 * Partai · Job, a partai keeps the routing and Standard Cost it started on, a
 * No. Job is one pickup, and standard cost is grams × rate.
 */

let f: ProductionFixture;
let s: Awaited<ReturnType<typeof sourceOf>>;
const date = new Date("2026-05-19T00:00:00Z");
const ids = {} as Record<string, number>;
let activeBefore: number[] = [];
let ownSegment = false;
const tx = <T,>(fn: Parameters<typeof prisma.$transaction>[0] extends never ? never : (t: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) =>
  prisma.$transaction(fn as never) as Promise<T>;

before(async () => {
  f = await makeProductionFixture("IDN");
  s = await sourceOf("log_stock_issue", "SI/TEST/IDN");
  const a = f.actor;
  activeBefore = (await prisma.prdRateVersion.findMany({ where: { status: "Active" }, select: { id: true } })).map((v) => v.id);
  await prisma.prdRateVersion.updateMany({ where: { status: "Active" }, data: { status: "Inactive" } });
  const version = async (tag: string, rate: number, status: "Active" | "Inactive") =>
    (
      await prisma.prdRateVersion.create({
        data: { rate_code: `test.${f.key(tag)}`, rate_label: f.key(tag), rate_name: tag, status, created_by: a, lines: { create: [{ unit_id: f.wsA, rate }] } },
      })
    ).id;
  ids.v1 = await version("V1", 182.8637, "Active");
  ids.line = (await prisma.prdLine.create({ data: { line_code: `test.${f.key("LN")}`, line_label: f.key("LN"), line_name: "Uji", created_by: a } })).id;
  ids.other = (await prisma.prdLine.create({ data: { line_code: `test.${f.key("LO")}`, line_label: f.key("LO"), line_name: "Lain", created_by: a } })).id;
  ids.routing = (
    await prisma.prdRouting.create({
      data: {
        routing_code: `test.${f.key("RT")}`,
        routing_label: f.key("RT"),
        routing_name: "Uji",
        line_id: ids.line,
        created_by: a,
        steps: { create: [{ seq: 1, unit_id: f.wsA, exit_mode: "WithQc", job_policy: "Carried" }] },
      },
    })
  ).id;
  const segment = await prisma.prdRouting.findFirst({ where: { line_id: null } });
  ownSegment = !segment;
  ids.segment = segment?.id ?? (await prisma.prdRouting.create({ data: { routing_code: `test.${f.key("SG")}`, routing_label: f.key("SG"), routing_name: "Segmen", created_by: a } })).id;
  await tx((t) => enterProduction(t, { lotId: f.lot, itemId: f.material, unitId: f.wsA, baseQty: 100, value: 100_000, date, source: s, actorId: a }));
});

after(async () => {
  await cleanupProduction([f.material, f.product, f.byproduct]);
  await prisma.prdPartai.deleteMany({ where: { line_id: ids.line } });
  await prisma.prdRoutingStep.deleteMany({ where: { routing_id: ids.routing } });
  await prisma.prdRouting.deleteMany({ where: { id: { in: ownSegment ? [ids.routing, ids.segment] : [ids.routing] } } });
  await prisma.prdLine.deleteMany({ where: { id: { in: [ids.line, ids.other] } } });
  await prisma.prdRateVersionLine.deleteMany({ where: { version_id: { in: [ids.v1, ids.v2] } } });
  await prisma.prdRateVersion.deleteMany({ where: { id: { in: [ids.v1, ids.v2] } } });
  await prisma.prdRateVersion.updateMany({ where: { id: { in: activeBefore } }, data: { status: "Active" } });
  await f.teardown();
  await cleanupFixtures();
  await disconnect();
});

describe("numbers per day (W11)", () => {
  test("the series names the prefix and the day; the next number follows the highest", () => {
    assert.equal(dailySeries("P", "2026-05-19"), "P_190526_");
    assert.equal(nextDailyNumber("P_190526_", null), "P_190526_00001");
    assert.equal(nextDailyNumber("P_190526_", "P_190526_00041"), "P_190526_00042");
  });
});

describe("the bucket and its stages (W29)", () => {
  test("goods enter Persiapan, advance to Stand By, and arrive in the next Unit's Persiapan", async () => {
    const first = (await availableBuckets({ unitIds: [f.wsA] }))[0];
    assert.equal(first.stage, "Preparation");
    const ready = await tx((t) => advanceToStandBy(t, { bucketId: first.id, baseQty: 40, date, source: s, actorId: f.actor }));
    assert.equal(ready.value, 40_000);
    const after = await availableBuckets({ unitIds: [f.wsA] });
    assert.deepEqual(after.map((b) => [b.stage, b.qty]).sort(), [["Preparation", 60], ["StandBy", 40]]);
    await assert.rejects(tx((t) => advanceToStandBy(t, { bucketId: ready.toBucketId, baseQty: 1, date, source: s, actorId: f.actor })), /sudah di Stand By/);
    const sent = await tx((t) => transferBucket(t, { bucketId: ready.toBucketId, toUnitId: f.wsB, baseQty: 10, date, source: s, actorId: f.actor }));
    assert.equal((await prisma.prdBalance.findUniqueOrThrow({ where: { id: sent.toBucketId } })).stage, "Preparation");
  });

  test("the same No. Stok in one Unit under two Jobs is two buckets (W31)", async () => {
    const standBy = (await availableBuckets({ unitIds: [f.wsA] })).find((b) => b.stage === "StandBy")!;
    for (const qty of [7, 3]) {
      const job = await tx((t) => issueJob(t, { unitId: f.wsA, lotId: f.lot, date, source: s, actorId: f.actor }));
      assert.match(job.no, /_190526_\d{5}$/);
      await tx((t) => transferBucket(t, { bucketId: standBy.id, toUnitId: f.wsB, baseQty: qty, jobId: job.id, date, source: s, actorId: f.actor }));
    }
    const atB = (await availableBuckets({ unitIds: [f.wsB] })).filter((b) => b.jobId);
    assert.deepEqual(atB.map((b) => b.qty).sort((a, b) => b - a), [7, 3]);
    assert.notEqual(atB[0].jobNo, atB[1].jobNo);
  });
});

describe("a partai keeps what it started on", () => {
  test("it follows a routing of its own line and keeps the version's id when that version closes (W36)", async () => {
    await assert.rejects(tx((t) => formPartai(t, { lineId: ids.other, routingId: ids.routing, date, source: s, actorId: f.actor })), /bukan milik line/);
    const partai = await tx((t) => formPartai(t, { lineId: ids.line, routingId: ids.routing, date, source: s, actorId: f.actor }));
    assert.match(partai.no, /^P_190526_\d{5}$/);
    assert.equal(partai.rateVersionId, ids.v1);
    await prisma.prdRateVersion.update({ where: { id: ids.v1 }, data: { status: "Inactive" } });
    ids.v2 = (await prisma.prdRateVersion.create({ data: { rate_code: `test.${f.key("V2")}`, rate_label: f.key("V2"), rate_name: "V2", status: "Active", created_by: f.actor } })).id;
    const row = await prisma.prdPartai.findUniqueOrThrow({ where: { id: partai.id } });
    assert.equal(row.rate_version_id, ids.v1);
    const next = await tx((t) => formPartai(t, { lineId: ids.line, routingId: ids.routing, date, source: s, actorId: f.actor }));
    assert.equal(next.rateVersionId, ids.v2, "a new partai takes the active version");
    ids.partai = partai.id;
  });

  test("a routing goods follow keeps its steps; another routing for the line is open", async () => {
    const steps = [{ unit_id: f.wsB, exit_mode: "WithQc", job_policy: "Carried", is_checkpoint: false, is_skippable: false }];
    const changed = await checkRoutingCollections({ line_id: ids.line, [STEPS_KEY]: JSON.stringify(steps) }, ids.routing);
    assert.match(changed.errors[STEPS_KEY] ?? "", /sudah dipakai/);
    const same = await checkRoutingCollections({ line_id: ids.line, [STEPS_KEY]: JSON.stringify([{ ...steps[0], unit_id: f.wsA }]) }, ids.routing);
    assert.equal(same.errors[STEPS_KEY], undefined, "saving it unchanged is fine");
  });
});

describe("what a No. Stok locked, and standard cost", () => {
  test("the info is written once: a later call returns what was locked", async () => {
    const first = await tx((t) => recordTrackingInfo(t, { lotId: f.lot, grams: 100, actorId: f.actor }));
    assert.deepEqual(first, { rateVersionId: ids.v2, routingId: ids.segment });
    const again = await tx((t) => recordTrackingInfo(t, { lotId: f.lot, grams: 5, rateVersionId: ids.v1, routingId: ids.routing, actorId: f.actor }));
    assert.deepEqual(again, first);
  });

  test("grams × the locked version's rate, rounded once; a Unit left out costs 0 (V1, W17)", async () => {
    const paid = await tx((t) => recordCostEntry(t, { unitId: f.wsA, rateVersionId: ids.v1, lotId: f.lot, partaiId: ids.partai, grams: 41_865, date, source: s, actorId: f.actor }));
    assert.deepEqual(paid, { amount: 7_655_589, rate: 182.8637 });
    const row = await prisma.prdCostEntry.findFirstOrThrow({ where: { tracking_id: f.lot, unit_id: f.wsA } });
    assert.equal(row.line_id, ids.line);
    const free = await tx((t) => recordCostEntry(t, { unitId: f.wsB, rateVersionId: ids.v1, lotId: f.lot, grams: 100, date, source: s, actorId: f.actor }));
    assert.deepEqual(free, { amount: 0, rate: 0 });
  });
});
