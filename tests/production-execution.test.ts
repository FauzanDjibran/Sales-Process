import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { shareGrading, shareWork } from "../src/lib/erp/production-execution";
import { availableBuckets, enterProduction, formPartai, issueJob, transferBucket } from "../src/lib/erp/production-ledger";
import { createGrading, getGrading, gradingPreview, transitionGrading, updateGrading, type GradingInput } from "../src/lib/erp/production-grading";
import { createWork, getWork, resultNotesOfJobs, transitionWork, workPreview, type WorkInput } from "../src/lib/erp/production-work";
import { createQcCheck, getQcCheck, qcOptions, transitionQcCheck } from "../src/lib/erp/production-qc";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma } from "./helpers";
import { cleanupProduction, makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * The documents of work at a Unit (menus 9–11): Dokumen Grading gives new No.
 * Stok and shares value by gram with BJL at 0; Pengerjaan Unit adds value and
 * keeps gram; QC Check moves whole rows, and a row turned back stays apart and
 * pays the unit cost again.
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
const SETTINGS = { absorbed: "production_absorbed_account", scrap: "production_scrap_account" };
let f: ProductionFixture;
let s: Awaited<ReturnType<typeof sourceOf>>;
const ids = {} as Record<string, number>;
const docs = { grading: [] as number[], work: [] as number[], qc: [] as number[] };
const saved = new Map<string, string | null | undefined>();
let activeBefore: number[] = [];
let ownSegment = false;

const tx = <T,>(fn: (t: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) => prisma.$transaction(fn as never) as Promise<T>;

async function grade(over: Partial<GradingInput>) {
  const r = await createGrading({ unit_id: ids.grader, grading_date: today, bucket_id: null, qty: 0, note: "", outputs: [], aux: [], ...over }, f.actor);
  if (r.ok) docs.grading.push(r.id);
  return r;
}
async function work(over: Partial<WorkInput>) {
  const r = await createWork({ unit_id: ids.passer, work_date: today, result_note: "", note: "", lines: [], aux: [], ...over }, f.actor);
  if (r.ok) docs.work.push(r.id);
  return r;
}
const persiapan = (unit: number) => availableBuckets({ unitIds: [unit], stage: "Preparation" });
const inQc = (unit: number) => availableBuckets({ unitIds: [unit], stage: "QcCheck" });
const standBy = (unit: number) => availableBuckets({ unitIds: [unit], stage: "StandBy" });

async function decide(unit: number, decisions: [number, "Pass" | "Return"][]) {
  const r = await createQcCheck({ unit_id: unit, qc_date: today, inspector: "QC", note: "", lines: decisions.map(([bucket_id, decision]) => ({ bucket_id, decision, reason: "" })) }, f.actor);
  assert.ok(r.ok, JSON.stringify(r));
  docs.qc.push(r.id);
  const p = await transitionQcCheck(r.id, "post", f.actor);
  assert.ok(p.ok, JSON.stringify(p));
  return r.id;
}

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("EXE");
  s = await sourceOf("log_stock_issue", "SI/TEST/EXE");
  const a = f.actor;
  ids.grader = f.wsA;
  ids.passer = f.wsB;
  await prisma.refUnit.update({ where: { id: f.wsA }, data: { process: "Grading", has_qc: true } });
  await prisma.refUnit.update({ where: { id: f.wsB }, data: { process: "PassThrough", has_qc: false } });
  ids.releaser = (await prisma.refUnit.create({ data: { unit_code: `test.${f.key("REL")}`, unit_label: f.key("REL"), unit_name: "Lepas", process: "Grading", releases_job: true, created_by: a } })).id;
  await prisma.mItem.update({ where: { id: f.byproduct }, data: { is_bjl: true } });

  ids.absorbed = await makeAccount({ subcategoryLabel: "5.1.1" });
  for (const [key, value] of [[SETTINGS.absorbed, ids.absorbed], [SETTINGS.scrap, f.scrapAcc]] as const) {
    saved.set(key, (await prisma.sysSetting.findUnique({ where: { setting_key: key } }))?.setting_value);
    await prisma.sysSetting.upsert({ where: { setting_key: key }, update: { setting_value: String(value) }, create: { setting_key: key, setting_value: String(value), updated_by: a } });
  }

  activeBefore = (await prisma.prdRateVersion.findMany({ where: { status: "Active" }, select: { id: true } })).map((v) => v.id);
  await prisma.prdRateVersion.updateMany({ where: { status: "Active" }, data: { status: "Inactive" } });
  ids.version = (
    await prisma.prdRateVersion.create({
      data: {
        rate_code: `test.${f.key("V")}`,
        rate_label: f.key("V"),
        rate_name: "Uji",
        status: "Active",
        created_by: a,
        lines: { create: [{ unit_id: f.wsA, rate: 100 }, { unit_id: f.wsB, rate: 10 }, { unit_id: ids.releaser, rate: 0 }] },
      },
    })
  ).id;
  const segment = await prisma.prdRouting.findFirst({ where: { line_id: null } });
  ownSegment = !segment;
  ids.segment = segment?.id ?? (await prisma.prdRouting.create({ data: { routing_code: `test.${f.key("SG")}`, routing_label: f.key("SG"), routing_name: "Segmen", created_by: a } })).id;
  ids.line = (await prisma.prdLine.create({ data: { line_code: `test.${f.key("LN")}`, line_label: f.key("LN"), line_name: "Uji", created_by: a } })).id;
  ids.routing = (await prisma.prdRouting.create({ data: { routing_code: `test.${f.key("RT")}`, routing_label: f.key("RT"), routing_name: "Uji", line_id: ids.line, created_by: a } })).id;
  const employee = async (t: string) =>
    (await prisma.mEmployee.create({ data: { employee_code: `test.${f.key(t)}`, employee_label: f.key(t), employee_name: t, created_by: a } })).id;
  ids.ani = await employee("ANI");
  ids.budi = await employee("BUDI");
  await tx((t) => enterProduction(t, { lotId: f.lot, itemId: f.material, unitId: f.wsA, baseQty: 1000, value: 1_000_000, date, source: s, actorId: a }));
});

after(async () => {
  await prisma.prdAuxUse.deleteMany({ where: { OR: [{ grading_id: { in: docs.grading } }, { work_id: { in: docs.work } }] } });
  await prisma.prdGrading.deleteMany({ where: { id: { in: docs.grading } } });
  await prisma.prdWork.deleteMany({ where: { id: { in: docs.work } } });
  await prisma.prdQcCheck.deleteMany({ where: { id: { in: docs.qc } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: { in: ["prd_grading", "prd_work", "prd_qc_check"] }, row_id: { in: [...docs.grading, ...docs.work, ...docs.qc] } } });
  await cleanupProduction([f.material, f.product, f.byproduct]);
  await prisma.prdPartai.deleteMany({ where: { line_id: ids.line } });
  await prisma.prdRouting.deleteMany({ where: { id: { in: ownSegment ? [ids.routing, ids.segment] : [ids.routing] } } });
  await prisma.prdLine.deleteMany({ where: { id: ids.line } });
  await prisma.prdCostEntry.deleteMany({ where: { rate_version_id: ids.version } });
  await prisma.prdRateVersionLine.deleteMany({ where: { version_id: ids.version } });
  await prisma.prdRateVersion.deleteMany({ where: { id: ids.version } });
  await prisma.prdRateVersion.updateMany({ where: { id: { in: activeBefore } }, data: { status: "Active" } });
  await prisma.mEmployee.deleteMany({ where: { id: { in: [ids.ani, ids.budi] } } });
  await prisma.refUnit.deleteMany({ where: { id: ids.releaser } });
  for (const [key, value] of saved) {
    if (value === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: key } });
    else await prisma.sysSetting.update({ where: { setting_key: key }, data: { setting_value: value } });
  }
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("the sharing arithmetic (V2, V3, W32)", () => {
  test("a grading shares by gram over non-BJL, the remainder to the largest; BJL is 0 (A18)", () => {
    const r = shareGrading(1000, [{ grams: 30, isBjl: false }, { grams: 30, isBjl: false }, { grams: 40, isBjl: false }, { grams: 50, isBjl: true }]);
    assert.deepEqual(r, { values: [300, 300, 400, 0], scrap: 0 });
    assert.equal(shareGrading(1001, [{ grams: 1, isBjl: false }, { grams: 2, isBjl: false }]).values.reduce((a, v) => a + v, 0), 1001);
  });
  test("only BJL outputs leave the whole value as scrap (A19)", () => {
    assert.deepEqual(shareGrading(500, [{ grams: 10, isBjl: true }]), { values: [0], scrap: 500 });
  });
  test("work keeps each line's own cost, moves BJL's cost over the others, and bahan penolong into its Job", () => {
    const lines = [
      { key: "a", grams: 100, isBjl: false, input: 1000, cost: 200 },
      { key: "b", grams: 100, isBjl: false, input: 500, cost: 200 },
      { key: "c", grams: 50, isBjl: true, input: 0, cost: 100 },
    ];
    const r = shareWork(lines, [{ key: "b", value: 70 }]);
    assert.deepEqual(r.values, [1250, 820, 0]);
    assert.deepEqual(r.auxValues, [0, 70, 0]);
    assert.equal(r.scrap, 0);
  });
  test("work on BJL alone has no receiver", () => {
    assert.equal(shareWork([{ key: "a", grams: 10, isBjl: true, input: 0, cost: 30 }], [{ key: null, value: 5 }]).scrap, 35);
  });
});

describe("Dokumen Grading", () => {
  test("it refuses goods that are not in this unit's Persiapan, or more than the row holds", async () => {
    const [b] = await persiapan(f.wsA);
    const over = await grade({ bucket_id: b.id, qty: 2000 });
    assert.ok(!over.ok && /Melebihi/.test(over.errors.qty));
    const wrong = await grade({ unit_id: f.wsB, bucket_id: b.id, qty: 10 });
    assert.ok(!wrong.ok && wrong.errors.unit_id);
  });

  test("Posting makes new No. Stok, shares value by gram and leaves the rest as balance (A11, A18)", async () => {
    const [b] = await persiapan(f.wsA);
    const r = await grade({ bucket_id: b.id, qty: 600, outputs: [{ item_id: f.product, grams: 300 }, { item_id: f.byproduct, grams: 250 }] });
    assert.ok(r.ok);
    assert.match(r.no, new RegExp(`^NG_${f.key("WSA")}_\\d{6}_00001$`));
    const preview = await gradingPreview(r.id, f.actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.equal(preview.lines.reduce((a, l) => a + l.debit, 0), 60_000, "the preview is the journal Posting writes");
    assert.equal(await prisma.prdCostEntry.count({ where: { source_no: r.no } }), 0, "the dry run wrote nothing");
    const p = await transitionGrading(r.id, "post", f.actor);
    assert.ok(p.ok, JSON.stringify(p));

    const g = (await getGrading(r.id))!;
    assert.equal(g.inputValue, 600_000);
    assert.equal(g.cost, 60_000, "gram × rate, on the gram of the input");
    assert.deepEqual(g.outputs.map((o) => o.value), [660_000, 0]);
    const lot = (await prisma.logStockTracking.findUniqueOrThrow({ where: { id: f.lot } })).tracking_no;
    assert.deepEqual(g.outputs.map((o) => o.trackingNo), [`${lot}-1`, `${lot}-2`]);
    assert.equal((await persiapan(f.wsA)).find((x) => x.id === b.id)?.qty, 400);
    assert.equal((await inQc(f.wsA)).length, 2, "a Unit with QC holds the result in QC Check");

    const lines = await prisma.accJournalLine.findMany({ where: { journal: { source_doc_id: r.id, source_doc_type_id: (await sourceOf("prd_grading", "x")).docTypeId } } });
    assert.equal(lines.find((l) => l.account_id === ids.absorbed)?.kredit_amount.toNumber(), 60_000);
    assert.equal(lines.find((l) => l.account_id === f.wipAcc)?.debit_amount.toNumber(), 60_000, "one WIP account: only the cost moves it");
    assert.equal(lines.length, 2);
  });

  test("the numbers run on across pickups of one No. Stok (W60)", async () => {
    const [b] = await persiapan(f.wsA);
    const r = await grade({ bucket_id: b.id, qty: 100, outputs: [{ item_id: f.product, grams: 100 }] });
    assert.ok(r.ok);
    assert.ok((await transitionGrading(r.id, "post", f.actor)).ok);
    const lot = (await prisma.logStockTracking.findUniqueOrThrow({ where: { id: f.lot } })).tracking_no;
    assert.equal((await getGrading(r.id))!.outputs[0].trackingNo, `${lot}-3`);
  });

  test("a grading of BJL alone charges the whole value to Beban Pemusnahan (A19)", async () => {
    const [b] = await persiapan(f.wsA);
    const r = await grade({ bucket_id: b.id, qty: 50, outputs: [{ item_id: f.byproduct, grams: 50 }] });
    assert.ok(r.ok);
    const p = await transitionGrading(r.id, "post", f.actor);
    assert.ok(p.ok, JSON.stringify(p));
    const g = (await getGrading(r.id))!;
    assert.equal(g.scrap, 55_000);
    const scrap = await prisma.accJournalLine.findFirst({ where: { account_id: f.scrapAcc, journal: { description: { startsWith: g.no } } } });
    assert.equal(scrap?.debit_amount.toNumber(), 55_000);
  });

  test("a Draft can be changed and cancelled, and moves nothing", async () => {
    const [b] = await persiapan(f.wsA);
    const before = b.qty;
    const r = await grade({ bucket_id: b.id, qty: 10, outputs: [{ item_id: f.product, grams: 10 }] });
    assert.ok(r.ok);
    const u = await updateGrading(r.id, { unit_id: ids.grader, grading_date: today, bucket_id: b.id, qty: 20, note: "", outputs: [{ item_id: f.product, grams: 20 }], aux: [] }, f.actor);
    assert.ok(u.ok);
    assert.equal((await getGrading(r.id))!.qty, 20);
    assert.ok(!(await transitionGrading(r.id, "cancel", f.actor)).ok, "a reason is required");
    assert.ok((await transitionGrading(r.id, "cancel", f.actor, "salah")).ok);
    assert.equal((await persiapan(f.wsA)).find((x) => x.id === b.id)?.qty, before);
  });
});

describe("QC Check", () => {
  test("every row is decided before Posting, and rows it does not hold are refused", async () => {
    const [row] = await inQc(f.wsA);
    const r = await createQcCheck({ unit_id: f.wsA, qc_date: today, inspector: "", note: "", lines: [{ bucket_id: row.id, decision: null, reason: "" }] }, f.actor);
    assert.ok(r.ok);
    docs.qc.push(r.id);
    const p = await transitionQcCheck(r.id, "post", f.actor);
    assert.ok(!p.ok && /Putuskan/.test(p.errors._form));
    const none = await createQcCheck({ unit_id: f.wsB, qc_date: today, inspector: "", note: "", lines: [{ bucket_id: row.id, decision: "Pass", reason: "" }] }, f.actor);
    assert.ok(!none.ok);
    assert.ok((await transitionQcCheck(r.id, "cancel", f.actor, "ulang")).ok);
  });

  test("Lulus goes to Stand By; Balik returns to Persiapan as its own row, with no journal (A25, W66)", async () => {
    const rows = await inQc(f.wsA);
    const product = rows.filter((b) => b.itemId === f.product);
    const bjl = rows.filter((b) => b.itemId === f.byproduct);
    assert.ok(product.length && bjl.length);
    const [ret, ...pass] = product;
    const qc = await decide(f.wsA, [[ret.id, "Return"], ...pass.map((b) => [b.id, "Pass"] as [number, "Pass"]), ...bjl.map((b) => [b.id, "Pass"] as [number, "Pass"])]);
    assert.equal((await inQc(f.wsA)).length, 0);
    const back = (await persiapan(f.wsA)).find((b) => b.lotId === ret.lotId);
    assert.equal(back?.qcCheckId, qc);
    assert.equal(back?.value, ret.value);
    assert.equal((await getQcCheck(qc))!.lines.find((l) => l.bucketId === ret.id)?.decision, "Return");
    assert.equal(await prisma.accJournal.count({ where: { description: { startsWith: (await getQcCheck(qc))!.no } } }), 0);
    const options = await qcOptions();
    assert.ok(!options.rows.some((x) => x.unitId === f.wsA));
  });

  test("goods worked again pay the unit cost again, recorded as rework (A26)", async () => {
    const back = (await persiapan(f.wsA)).find((b) => b.qcCheckId != null)!;
    const r = await grade({ bucket_id: back.id, qty: back.qty, outputs: [{ item_id: f.product, grams: back.qty }] });
    assert.ok(r.ok);
    assert.ok((await transitionGrading(r.id, "post", f.actor)).ok);
    const entry = await prisma.prdCostEntry.findFirstOrThrow({ where: { source_no: r.no } });
    assert.equal(entry.is_rework, true);
    assert.equal(entry.amount.toNumber(), back.qty * 100);
  });
});

describe("Pengerjaan Unit", () => {
  const sendToPasser = async (partaiId: number | null) => {
    const b = (await standBy(f.wsA)).find((x) => x.itemId === f.product && x.partaiId == null && x.qty > 0);
    assert.ok(b, "goods in Stand By");
    return tx(async (t) => {
      const job = await issueJob(t, { unitId: f.wsA, lotId: b.lotId, partaiId, date, source: s, actorId: f.actor });
      const moved = await transferBucket(t, { bucketId: b.id, baseQty: Math.min(50, b.qty), toUnitId: f.wsB, partaiId, jobId: job.id, date, source: s, actorId: f.actor });
      return { ...moved, jobId: job.id };
    });
  };

  test("a No. Job needs exactly one karyawan (A13, W74)", async () => {
    await tx((t) => enterProduction(t, { lotId: f.lot, itemId: f.material, unitId: f.wsA, baseQty: 200, value: 200_000, date, source: s, actorId: f.actor }));
    const [b] = (await persiapan(f.wsA)).filter((x) => x.itemId === f.material);
    const g = await grade({ bucket_id: b.id, qty: 200, outputs: [{ item_id: f.product, grams: 100 }, { item_id: f.product, grams: 100 }] });
    assert.ok(g.ok);
    assert.ok((await transitionGrading(g.id, "post", f.actor)).ok);
    await decide(f.wsA, (await inQc(f.wsA)).map((x) => [x.id, "Pass"]));
    const sent = await sendToPasser(null);
    const none = await work({ lines: [{ bucket_id: sent.toBucketId, qty: 50, employee_id: null }] });
    assert.ok(!none.ok && /karyawan/.test(none.errors["lines.0.employee_id"]));
  });

  test("Posting keeps gram and No. Job and adds gram × rate; a Unit without QC goes to Stand By (A14)", async () => {
    const [b] = await persiapan(f.wsB);
    const r = await work({ result_note: "Jenis A, 50 g", lines: [{ bucket_id: b.id, qty: b.qty, employee_id: ids.ani }] });
    assert.ok(r.ok);
    const preview = await workPreview(r.id, f.actor);
    assert.ok(preview.ok && preview.lines.reduce((a, l) => a + l.credit, 0) === b.qty * 10, JSON.stringify(preview));
    const p = await transitionWork(r.id, "post", f.actor);
    assert.ok(p.ok, JSON.stringify(p));
    const w = (await getWork(r.id))!;
    assert.equal(w.cost, b.qty * 10);
    assert.equal(w.lines[0].value, b.value + b.qty * 10);
    const [out] = await standBy(f.wsB);
    assert.equal(out.lotId, b.lotId);
    assert.equal(out.jobId, b.jobId);
    assert.equal(out.qty, b.qty);
    assert.deepEqual((await resultNotesOfJobs([b.jobId!])).get(b.jobId!), ["Jenis A, 50 g"]);
  });

  test("one document holds one partai (A29)", async () => {
    const partai = await tx((t) => formPartai(t, { lineId: ids.line, routingId: ids.routing, date, source: s, actorId: f.actor }));
    const other = await tx((t) => formPartai(t, { lineId: ids.line, routingId: ids.routing, date, source: s, actorId: f.actor }));
    const a = await sendToPasser(partai.id);
    const b = await sendToPasser(other.id);
    const r = await work({ lines: [{ bucket_id: a.toBucketId, qty: 10, employee_id: ids.ani }, { bucket_id: b.toBucketId, qty: 10, employee_id: ids.budi }] });
    assert.ok(!r.ok && /satu partai/.test(r.errors["lines.1.bucket_id"]));
  });

  test("bahan penolong adds value to its Job, not gram (A28)", async () => {
    await tx((t) => enterProduction(t, { lotId: (ids.auxLot = f.lot), itemId: f.material, unitId: f.wsB, baseQty: 10, value: 5_000, auxiliary: true, date, source: s, actorId: f.actor }));
    const [aux] = (await persiapan(f.wsB)).length ? (await availableBuckets({ unitIds: [f.wsB], stage: "Preparation" })).filter((x) => x.auxiliary) : [];
    assert.ok(aux, "the Unit's balance");
    const goods = (await persiapan(f.wsB)).find((x) => !x.auxiliary)!;
    const r = await work({ lines: [{ bucket_id: goods.id, qty: goods.qty, employee_id: ids.ani }], aux: [{ bucket_id: aux.id, qty: 4, job_id: goods.jobId }] });
    assert.ok(r.ok, JSON.stringify(r));
    const p = await transitionWork(r.id, "post", f.actor);
    assert.ok(p.ok, JSON.stringify(p));
    const w = (await getWork(r.id))!;
    assert.equal(w.auxValue, 2_000);
    assert.equal(w.lines[0].value, goods.value + goods.qty * 10 + 2_000);
    assert.equal(w.lines[0].grams, goods.qty);
  });

  test("a Unit marked Lepas No. Job drops it at grading; the partai stays (W92)", async () => {
    const b = (await availableBuckets({ unitIds: [f.wsB], stage: "Preparation" })).find((x) => !x.auxiliary)!;
    const standing = await tx(async (t) => {
      const j = await issueJob(t, { unitId: f.wsB, lotId: b.lotId, partaiId: b.partaiId, date, source: s, actorId: f.actor });
      const w = await createWork({ unit_id: f.wsB, work_date: today, result_note: "", note: "", lines: [{ bucket_id: b.id, qty: b.qty, employee_id: ids.ani }], aux: [] }, f.actor);
      return { j, w };
    });
    assert.ok(standing.w.ok);
    docs.work.push(standing.w.id);
    assert.ok((await transitionWork(standing.w.id, "post", f.actor)).ok);
    const ready = (await standBy(f.wsB)).find((x) => x.partaiId === b.partaiId)!;
    const moved = await tx((t) => transferBucket(t, { bucketId: ready.id, baseQty: ready.qty, toUnitId: ids.releaser, date, source: s, actorId: f.actor }));
    const r = await grade({ unit_id: ids.releaser, bucket_id: moved.toBucketId, qty: ready.qty, outputs: [{ item_id: f.product, grams: ready.qty }] });
    assert.ok(r.ok);
    assert.ok((await transitionGrading(r.id, "post", f.actor)).ok);
    const [out] = await standBy(ids.releaser);
    assert.equal(out.jobId, null);
    assert.equal(out.partaiId, b.partaiId);
  });
});
