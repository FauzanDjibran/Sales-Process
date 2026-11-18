import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { availableBuckets, enterProduction } from "../src/lib/erp/production-ledger";
import { getJobOrder, postJobOrder, type JobOrderInput } from "../src/lib/erp/production-job-order";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { cleanupProduction, makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * Job Order (P283, T7). Unit M does Job Order › Assign: goods wait at Persiapan Job
 * Order, a Job Order mixes them (in part) into a new No. Stok with its own No. Job,
 * which waits at Persiapan Assign. No Unit rate is charged (P281).
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
let f: ProductionFixture;
let s: Awaited<ReturnType<typeof sourceOf>>;
const ids = {} as Record<string, number>;
const docs: number[] = [];

const prep = (unit: number) => availableBuckets({ unitIds: [unit], stage: "Preparation" });

async function lotAt(unit: number, qty: number, value: number) {
  const lot = await prisma.logStockTracking.create({
    data: { tracking_no: f.key(`J${Math.random().toString(36).slice(2, 6)}`), tracking_date: date, item_id: f.material, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: f.actor },
  });
  await prisma.$transaction((t) => enterProduction(t, { lotId: lot.id, itemId: f.material, unitId: unit, baseQty: qty, value, date, source: s, actorId: f.actor }));
  return (await prep(unit)).find((b) => b.lotId === lot.id)!;
}

async function post(over: Partial<JobOrderInput>) {
  const r = await postJobOrder({ unit_id: ids.m, doc_date: today, note: "", lines: [], ...over }, f.actor);
  if (r.ok) docs.push(r.id);
  return r;
}

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("JO");
  s = await sourceOf("log_stock_issue", "SI/TEST/JO");
  ids.m = (
    await prisma.refUnit.create({ data: { unit_code: `test.${f.key("M")}`, unit_label: f.key("M"), unit_name: "Moulding", created_by: f.actor, steps: { create: [{ seq: 1, process: "JobOrder" }, { seq: 2, process: "Assign" }] } } })
  ).id;
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_job_order", row_id: { in: docs } } });
  await prisma.prdJobOrder.deleteMany({ where: { id: { in: docs } } });
  await cleanupProduction([f.material, f.product, f.byproduct]);
  await prisma.refUnit.deleteMany({ where: { id: ids.m } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Job Order", () => {
  test("mixes No. Stok, in part, into one new No. Stok with its own No. Job; gram and value kept, no cost", async () => {
    const a = await lotAt(ids.m, 300, 3_000);
    const b = await lotAt(ids.m, 200, 4_000);
    const r = await post({ lines: [{ target_item_id: f.product, parts: [{ bucket_id: a.id, qty: 150 }, { bucket_id: b.id, qty: 200 }] }] });
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.no, new RegExp(`^JOD_${f.key("M")}_\\d{6}_00001$`));
    const doc = (await getJobOrder(r.id))!;
    const line = doc.items[0];
    assert.equal(line.grams, 350);
    assert.ok(line.trackingNo.startsWith(`${b.lotNo}-`), "numbered from the input that gave the most gram");
    assert.equal(line.jobOrderNo, `JO_${line.jobNo}`);
    const assign = (await prisma.refUnitStep.findFirstOrThrow({ where: { unit_id: ids.m, process: "Assign" } })).id;
    const made = (await prep(ids.m)).find((x) => x.lotNo === line.trackingNo)!;
    assert.equal(made.stepId, assign, "waits at the next step");
    assert.equal(made.qty, 350);
    assert.equal(made.value, 1_500 + 4_000, "half of A's value and all of B's");
    assert.equal(made.itemId, f.product);
    assert.ok(made.jobId);
    assert.equal((await prep(ids.m)).find((x) => x.id === a.id)?.qty, 150, "the rest of A stays");
    assert.equal(await prisma.prdCostEntry.count({ where: { source_no: r.no } }), 0, "no Unit rate at Job Order");
    assert.equal(await prisma.prdTrackingLink.count({ where: { source_no: r.no } }), 2);
  });

  test("refuses more than the bucket holds across lines, and goods not at Persiapan Job Order", async () => {
    const a = await lotAt(ids.m, 100, 1_000);
    const over = await post({ lines: [{ target_item_id: f.product, parts: [{ bucket_id: a.id, qty: 60 }] }, { target_item_id: f.product, parts: [{ bucket_id: a.id, qty: 60 }] }] });
    assert.ok(!over.ok && /melebihi saldo/.test(Object.values(over.errors).join(" ")), JSON.stringify(over));
    const made = (await prep(ids.m)).find((x) => x.stepId !== a.stepId)!;
    const wrong = await post({ lines: [{ target_item_id: f.product, parts: [{ bucket_id: made.id, qty: 1 }] }] });
    assert.ok(!wrong.ok && /Persiapan Job Order/.test(Object.values(wrong.errors).join(" ")));
    const noTarget = await post({ lines: [{ target_item_id: null, parts: [{ bucket_id: a.id, qty: 1 }] }] });
    assert.ok(!noTarget.ok && noTarget.errors["lines.0.target_item_id"]);
  });
});
