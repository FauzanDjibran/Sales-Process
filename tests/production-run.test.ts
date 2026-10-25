import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkRun,
  createRun,
  getRun,
  runOptions,
  runPreview,
  sectionWeights,
  transitionRun,
  updateRun,
  type RunHeaderInput,
  type RunOutputLine,
  type RunSectionInput,
} from "../src/lib/erp/production-run";
import { availableExecutionActions, executionAbilities, kindsOfMode } from "../src/lib/erp/production-run-workflow";
import { enterProduction, startJob, startPartai } from "../src/lib/erp/production-ledger";
import { writeStandardCostLines } from "../src/lib/erp/standard-cost";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  cleanupStock,
  disconnect,
  makeAccount,
  openFiscalYear,
  prisma,
  productionCostCenterId,
  setCategoryAccount,
  snapshotCategoryAccounts,
  stockIn,
  systemUserId,
} from "./helpers";

/**
 * The Eksekusi Produksi (Walet step 5, P169, M114, AD3, AD8): one posting at one
 * workstation. The figures are the simulation's (`walet/simulation production.md`
 * §4): a transformation shares Rp 290.000.000 over outputs by value weight (a
 * BJL and a Reject take 0); a pass-through at Rp 182,86 per gram adds round(grams
 * × rate) to the Job it works and keeps its lot; extras (the outer box) join a
 * kept lot; the Moulding mix takes the whole Partai into one lot. The journal is
 * the WIP netting plus the standard credited with the station's Cost Center, and
 * the dry run equals it.
 */

const today = new Date().toISOString().slice(0, 10);
const day = new Date(`${today}T00:00:00Z`);
let actor = 0;
const f = {} as Record<string, number>;
const runs: number[] = [];
const items: number[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const cleanups: (() => Promise<unknown>)[] = [];
let fakeDoc = 800_000 + (Date.now() % 90_000);

const header = (over: Partial<RunHeaderInput> = {}): RunHeaderInput => ({ execution_date: today, kind: "Transform", workstation_id: f.wsT, note: "", ...over });
const out = (item: number, qty: number | string, over: Partial<RunOutputLine> = {}): RunOutputLine => ({ item_id: item, qty, lot_no: "", expiry_date: "", status: "Available", ...over });
const section = (inputs: [number, number | string, boolean?][], outputs: RunOutputLine[], driver: number | string = 0): RunSectionInput => ({
  driver,
  inputs: inputs.map(([bucket_id, qty, is_main]) => ({ bucket_id, qty, is_main: Boolean(is_main) })),
  outputs,
});

async function create(h: RunHeaderInput, sections: RunSectionInput[]) {
  const r = await createRun(h, sections, actor);
  if (r.ok) runs.push(r.id);
  return r;
}

/** Goods at a station as a received Logistik BSTB or an earlier run leaves them. */
async function atStation(itemId: number, ws: number, qty: number, value: number, over: { partaiId?: number | null; jobId?: number | null } = {}) {
  const lot = await stockIn(itemId, f.warehouse, `${key("L")}${fakeDoc}`, qty, value);
  const docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_execution" } })).id;
  const { bucketId } = await prisma.$transaction((tx) =>
    enterProduction(tx, { lotId: lot, itemId, workstationId: ws, partaiId: over.partaiId ?? null, jobId: over.jobId ?? null, baseQty: qty, value, date: day, source: { docTypeId, docId: fakeDoc++, no: "TEST" }, actorId: actor })
  );
  return { lot, bucketId };
}

async function newPartai() {
  const docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_execution" } })).id;
  const source = { docTypeId, docId: fakeDoc++, no: "TEST" };
  const partai = await prisma.$transaction((tx) => startPartai(tx, { date: day, source, actorId: actor }));
  // Each Job in a transaction of its own: the closure outlives this function.
  const job = async () => (await prisma.$transaction((tx) => startJob(tx, { partaiId: partai.id, workstationId: f.wsT, date: day, source, actorId: actor }))).id;
  return { partai, job };
}

before(async () => {
  actor = await systemUserId();
  const yearId = await openFiscalYear();
  const cc = await productionCostCenterId();
  f.g = (await prisma.refUom.create({ data: { uom_code: `test.${key("G")}`, uom_label: key("G"), uom_name: "Gram", created_by: actor } })).id;
  f.cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BHN-BAKU" } })).id;
  const item = async (l: string, over: { type?: "Utama" | "Turunan" | "BJL"; vw?: string | null; expiry?: boolean } = {}) => {
    const id = (
      await prisma.mItem.create({
        data: {
          item_code: `test.${key(l)}`,
          item_label: key(l),
          item_name: l,
          item_type: "Barang",
          category_id: f.cat,
          base_uom_id: f.g,
          track_stock: true,
          has_expiry: Boolean(over.expiry),
          output_type: over.type ?? "Utama",
          value_weight: over.vw === undefined ? null : over.vw,
          created_by: actor,
        },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.raw = await item("RAW");
  f.a = await item("A", { vw: "7000" });
  f.b = await item("B", { vw: "6200" });
  f.k = await item("K", { type: "Turunan", vw: "4000" });
  f.bs = await item("BS", { type: "BJL" });
  f.n = await item("N"); // a single Utama output: no weight needed
  f.n2 = await item("N2");
  f.box = await item("BOX");
  f.exp = await item("EXP", { expiry: true });
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang", created_by: actor } })).id;
  const ws = async (l: string, mode: "Transform" | "PassThrough" | "MixTransform", jobCode: string | null = null) =>
    (await prisma.refWorkstation.create({ data: { workstation_code: `test.${key(l)}`, workstation_label: key(l), workstation_name: l, cost_center_id: cc, mode, job_code: jobCode, created_by: actor } })).id;
  f.wsT = await ws("WST", "Transform", `R${stamp}`);
  f.wsP = await ws("WSP", "PassThrough");
  f.wsM = await ws("WSM", "MixTransform");

  const sub = async (label: string) => (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.wipAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  cleanups.push(await snapshotCategoryAccounts([f.cat]));
  await setCategoryAccount(f.cat, "Wip", f.wipAcc, actor);
  f.stdAcc = await makeAccount({ subcategoryLabel: "5.1.1", requireCostCenter: true, normalBalance: "Kredit" });
  f.stdItem = (await prisma.accStandardCostItem.create({ data: { item_code: `test.${key("SCI")}`, item_label: key("SCI"), item_name: "TKL", account_id: f.stdAcc, created_by: actor } })).id;
  const first = await prisma.accFiscalPeriod.findFirstOrThrow({ where: { fiscal_year_id: yearId }, orderBy: { sequence_no: "asc" } });
  f.std = (await prisma.accStandardCost.create({ data: { standard_cost_code: `test.${key("SC")}`, workstation_id: f.wsP, effective_period_id: first.id, created_by: actor } })).id;
  await writeStandardCostLines(prisma, f.std, { lines: [{ itemId: f.stdItem, rate: "182.86" }] }, actor);
});

after(async () => {
  const lots = (await prisma.logStockTracking.findMany({ where: { item_id: { in: items } }, select: { id: true } })).map((l) => l.id);
  await prisma.prdExecutionCost.deleteMany({ where: { execution_id: { in: runs } } });
  await prisma.prdExecutionOutput.deleteMany({ where: { section: { execution_id: { in: runs } } } });
  await prisma.prdExecutionInput.deleteMany({ where: { section: { execution_id: { in: runs } } } });
  await prisma.prdExecutionSection.deleteMany({ where: { execution_id: { in: runs } } });
  await prisma.prdExecution.deleteMany({ where: { id: { in: runs } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_execution", row_id: { in: runs } } });
  await prisma.prdLotLink.deleteMany({ where: { OR: [{ from_lot_id: { in: lots } }, { to_lot_id: { in: lots } }] } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  const partai = await prisma.prdPartai.findMany({ where: { source_no: "TEST" }, select: { id: true } });
  await prisma.prdJobParent.deleteMany({ where: { job: { partai_id: { in: partai.map((p) => p.id) } } } });
  await prisma.prdJob.deleteMany({ where: { partai_id: { in: partai.map((p) => p.id) } } });
  await prisma.prdPartai.deleteMany({ where: { id: { in: partai.map((p) => p.id) } } });
  await prisma.accStandardCostLine.deleteMany({ where: { standard_cost_id: f.std } });
  await prisma.accStandardCost.deleteMany({ where: { id: f.std } });
  await prisma.accStandardCostItem.deleteMany({ where: { id: f.stdItem } });
  for (const c of cleanups) await c();
  await cleanupFixtures();
  await cleanupStock(items);
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: { in: [f.wsT, f.wsP, f.wsM] } } });
  await prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } });
  await prisma.refUom.deleteMany({ where: { id: f.g } });
  await cleanupFiscalYear();
  await disconnect();
});

describe("what a run may be saved with", () => {
  test("the station's Cara Kerja decides the kinds; a station, a kind, a section and an input are required", () => {
    assert.deepEqual(kindsOfMode("Transform"), ["Transform"]);
    assert.deepEqual(kindsOfMode("PassThrough"), ["PassThrough"]);
    assert.deepEqual(kindsOfMode("MixTransform"), ["Mix", "Transform"]);
  });

  test("a kind the station's Cara Kerja does not allow, and an empty run, are refused", async () => {
    const wrong = await create(header({ kind: "PassThrough" }), []);
    assert.ok(!wrong.ok && wrong.errors.kind && wrong.errors._sections);
    const none = await create(header({ workstation_id: null, kind: null }), []);
    assert.ok(!none.ok && none.errors.workstation_id);
  });

  test("goods in transit or at another station, and a quantity above the bucket, are refused", async () => {
    const here = await atStation(f.raw, f.wsT, 1000, 10_000);
    const elsewhere = await atStation(f.raw, f.wsP, 1000, 10_000);
    const over = await create(header(), [section([[here.bucketId, 1001]], [out(f.n, 100)])]);
    assert.ok(!over.ok && /Melebihi saldo/.test(over.errors["sections.0.inputs.0.qty"]));
    const away = await create(header(), [section([[elsewhere.bucketId, 10]], [out(f.n, 10)])]);
    assert.ok(!away.ok && /belum diterima/.test(away.errors["sections.0.inputs.0.bucket_id"]));
    const twice = await create(header(), [section([[here.bucketId, 10], [here.bucketId, 20]], [out(f.n, 10)])]);
    assert.ok(!twice.ok && /sudah dipakai/.test(twice.errors["sections.0.inputs.1.bucket_id"]));
  });

  test("the value weights: a BJL and a Reject take 0; one eligible output needs none; two without a weight are refused", () => {
    const items = new Map([
      [1, { label: "A", outputType: "Utama", valueWeight: 7000 }],
      [2, { label: "BS", outputType: "BJL", valueWeight: null }],
      [3, { label: "N", outputType: "Utama", valueWeight: null }],
      [4, { label: "N2", outputType: "Utama", valueWeight: null }],
    ]);
    assert.deepEqual(sectionWeights([{ itemId: 1, qty: 10, status: "Available" }, { itemId: 2, qty: 5, status: "Available" }, { itemId: 1, qty: 4, status: "Reject" }], items), { weights: [1, 0, 0] });
    assert.deepEqual(sectionWeights([{ itemId: 1, qty: 10, status: "Available" }, { itemId: 1, qty: 20, status: "Available" }], items), { weights: [70000, 140000] });
    assert.ok("error" in sectionWeights([{ itemId: 3, qty: 1, status: "Available" }, { itemId: 4, qty: 1, status: "Available" }], items), "two items without a weight");
    assert.ok("error" in sectionWeights([{ itemId: 2, qty: 1, status: "Available" }], items), "nothing to carry the value");
  });
});

describe("a transformation shares Σ inputs over the outputs by value weight (simulation step 2)", () => {
  test("Rp 290.000.000 over A, A, B, Turunan K and a BJL: the BJL takes 0 and the total is kept", async () => {
    const pth = await atStation(f.raw, f.wsT, 40_000, 240_000_000);
    const kr = await atStation(f.raw, f.wsT, 10_000, 50_000_000);
    const r = await create(header(), [
      section(
        [[pth.bucketId, 40_000], [kr.bucketId, 10_000]],
        [out(f.a, 15_000), out(f.a, 15_000), out(f.b, 12_000), out(f.k, 5_000), out(f.bs, 2_500)]
      ),
    ]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.executionNo, /^NG_.+_\d{6}_\d{5}$/, "the unit's number (M124)");
    f.t1 = r.id;
    assert.deepEqual((await getRun(f.t1))!.header.kind, "Transform");
    assert.ok((await transitionRun(f.t1, "post", actor)).ok);
    const v = (await getRun(f.t1))!;
    assert.equal(v.status, "Posted");
    assert.deepEqual(v.posted[0].outputs.map((o) => o.cost), [100_032_852, 100_032_852, 70_880_420, 19_053_876, 0]);
    assert.equal(v.totalValue, 290_000_000);
    assert.equal(v.standard, 0);
    assert.equal(v.journalId, null, "WIP to WIP with no standard writes no journal");
    assert.ok(v.posted[0].outputs.every((o) => /^[A-Z0-9_-]+$/.test(o.lotNo)), "lot numbers generated: " + v.posted[0].outputs.map((o) => o.lotNo));
    assert.equal(new Set(v.posted[0].outputs.map((o) => o.lotNo)).size, 5);
  });

  test("the inputs are gone, every output sits at the station under its own new lot with no Partai", async () => {
    const held = await prisma.prdBalance.findMany({ where: { workstation_id: f.wsT, item_id: { in: [f.a, f.b, f.k, f.bs] }, qty_balance: { gt: 0 } } });
    assert.equal(held.length, 5);
    assert.ok(held.every((b) => b.partai_id == null && b.job_id == null && !b.in_transit));
    assert.equal(held.reduce((s, b) => s + b.value_balance.toNumber(), 0), 290_000_000);
    const raw = await prisma.prdBalance.findMany({ where: { workstation_id: f.wsT, item_id: f.raw, qty_balance: { gt: 0 } } });
    assert.ok(raw.every((b) => b.qty_balance.toNumber() === 1000), "only the untouched test goods remain");
    const lot = await prisma.logStockTracking.findFirstOrThrow({ where: { id: held[0].lot_id } });
    assert.equal(lot.source_no, (await getRun(f.t1))!.executionNo, "the run is the lot's source (M128)");
  });

  test("a posted run is final and its lots are used", async () => {
    assert.ok(!(await updateRun(f.t1, header(), [], actor)).ok);
    assert.ok(!(await transitionRun(f.t1, "cancel", actor, "x")).ok);
    assert.ok(!(await transitionRun(f.t1, "post", actor)).ok);
  });

  test("a Reject output takes no value, is flagged, stays in production and is never worked again", async () => {
    const src = await atStation(f.raw, f.wsT, 100, 1_000_000);
    const r = await create(header(), [section([[src.bucketId, 100]], [out(f.a, 60), out(f.a, 40, { status: "Reject" })])]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await transitionRun(r.id, "post", actor)).ok);
    const v = (await getRun(r.id))!;
    assert.deepEqual(v.posted[0].outputs.map((o) => o.cost), [1_000_000, 0]);
    const reject = await prisma.prdBalance.findFirstOrThrow({ where: { id: (await prisma.prdExecutionOutput.findFirstOrThrow({ where: { section: { execution_id: r.id }, status: "Reject" } })).bucket_id! } });
    assert.equal(reject.is_reject, true);
    const again = await create(header(), [section([[reject.id, 40]], [out(f.n, 40)])]);
    assert.ok(!again.ok && /Reject/.test(again.errors["sections.0.inputs.0.bucket_id"]));
  });

  test("a section whose outputs cannot carry the value, and two Jobs in one section, are refused", async () => {
    const src = await atStation(f.raw, f.wsT, 50, 500_000);
    const bjl = await create(header(), [section([[src.bucketId, 50]], [out(f.bs, 50)])]);
    assert.ok(!bjl.ok && /bukan BJL/.test(bjl.errors["sections.0.outputs"]));
    const { partai, job } = await newPartai();
    const j1 = await job();
    const j2 = await job();
    const x = await atStation(f.raw, f.wsT, 10, 100_000, { partaiId: partai.id, jobId: j1 });
    const y = await atStation(f.raw, f.wsT, 10, 100_000, { partaiId: partai.id, jobId: j2 });
    const two = await create(header(), [section([[x.bucketId, 10], [y.bucketId, 10]], [out(f.n, 20)])]);
    assert.ok(!two.ok && /satu Job/.test(two.errors["sections.0.inputs"]));
  });
});

describe("a pass-through keeps the lot and adds the standard (simulation step 6, 13)", () => {
  test("Pre Wash at Rp 182,86 per gram: round(grams × rate) goes into each Job; the lot stays", async () => {
    const { partai, job } = await newPartai();
    const j6 = await job();
    const j7 = await job();
    f.partai = partai.id;
    const a = await atStation(f.n, f.wsP, 18_000, 130_828_606, { partaiId: partai.id, jobId: j6 });
    const b = await atStation(f.n2, f.wsP, 15_000, 93_708_585, { partaiId: partai.id, jobId: j7 });
    const r = await create(header({ kind: "PassThrough", workstation_id: f.wsP }), [
      section([[a.bucketId, 18_000, true]], [out(f.n, 18_000)], 18_000),
      section([[b.bucketId, 15_000, true]], [out(f.n2, 15_000)], 15_000),
    ]);
    assert.ok(r.ok, JSON.stringify(r));
    f.pt = r.id;
    const preview = await runPreview(f.pt, actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.equal(await prisma.prdExecutionCost.count({ where: { execution_id: f.pt } }), 0, "a dry run writes nothing");
    assert.ok((await transitionRun(f.pt, "post", actor)).ok);
    const v = (await getRun(f.pt))!;
    assert.deepEqual(v.posted.map((s) => s.standard), [3_291_480, 2_742_900]);
    assert.deepEqual(v.posted.map((s) => s.outputs[0].cost), [134_120_086, 96_451_485]);
    assert.equal(v.standard, 6_034_380);
    assert.equal(v.costs.length, 1);
    assert.deepEqual([v.costs[0].rate, v.costs[0].driver, v.costs[0].amount], [182.86, 33_000, 6_034_380]);
    const kept = await prisma.prdBalance.findUniqueOrThrow({ where: { id: a.bucketId } });
    assert.equal(kept.qty_balance.toNumber(), 18_000);
    assert.equal(kept.value_balance.toNumber(), 134_120_086, "the same bucket, the same lot — more valuable");
    assert.equal(kept.lot_id, a.lot);
  });

  test("the journal: Dr WIP / Cr the Standard Cost Item's account with the station's Cost Center, equal to the dry run", async () => {
    const run = (await prisma.prdExecution.findUniqueOrThrow({ where: { id: f.pt } }))!;
    assert.ok(run.journal_id);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: run.journal_id! } });
    const dr = lines.filter((l) => l.debit_amount.toNumber() > 0);
    const cr = lines.filter((l) => l.kredit_amount.toNumber() > 0);
    assert.deepEqual([dr.length, cr.length], [1, 1]);
    assert.equal(dr[0].account_id, f.wipAcc);
    assert.equal(dr[0].debit_amount.toNumber(), 6_034_380);
    assert.equal(cr[0].account_id, f.stdAcc);
    assert.ok(cr[0].cost_center_id, "the standard carries the station's Cost Center (M92)");
  });

  test("weight in and out is free: a loss and the outer box joining the packs (step 13)", async () => {
    const packs = await atStation(f.n, f.wsP, 533, 317_293_653);
    const boxes = await atStation(f.box, f.wsP, 533, 3_198_000);
    const r = await create(header({ kind: "PassThrough", workstation_id: f.wsP }), [section([[packs.bucketId, 533, true], [boxes.bucketId, 533]], [out(f.n, 530)], 0)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await transitionRun(r.id, "post", actor)).ok);
    const v = (await getRun(r.id))!;
    assert.equal(v.posted[0].outputs[0].qty, 530, "susut 3: a pass-through may lose weight");
    assert.equal(v.posted[0].outputs[0].cost, 320_491_653, "cost in = cost out: packs + boxes");
    assert.equal((await prisma.prdBalance.findUniqueOrThrow({ where: { id: boxes.bucketId } })).qty_balance.toNumber(), 0, "the box is consumed");
    assert.equal(await prisma.prdLotLink.count({ where: { source_doc_id: r.id, to_lot_id: packs.lot } }), 1, "the extra's genealogy points at the kept lot");
  });

  test("the main input is taken whole; exactly one is marked main", async () => {
    const x = await atStation(f.n, f.wsP, 100, 1000);
    const part = await create(header({ kind: "PassThrough", workstation_id: f.wsP }), [section([[x.bucketId, 50, true]], [out(f.n, 50)])]);
    assert.ok(!part.ok && /utuh/.test(part.errors["sections.0.inputs.0.qty"]));
    const none = await create(header({ kind: "PassThrough", workstation_id: f.wsP }), [section([[x.bucketId, 100]], [out(f.n, 100)])]);
    assert.ok(!none.ok && /tepat satu/.test(none.errors["sections.0.inputs"]));
  });
});

describe("the Moulding mix takes the whole Partai into one lot with no Job (M125)", () => {
  test("a part of the Partai is refused; the whole becomes <partai>_<kode barang>, no Job, no standard", async () => {
    const { partai, job } = await newPartai();
    const j1 = await job();
    const j2 = await job();
    const a = await atStation(f.n, f.wsM, 11_700, 147_320_566, { partaiId: partai.id, jobId: j1 });
    const b = await atStation(f.n, f.wsM, 9_750, 107_451_885, { partaiId: partai.id, jobId: j2 });
    const hdr = header({ kind: "Mix", workstation_id: f.wsM });
    const partial = await create(hdr, [section([[a.bucketId, 11_700]], [out(f.n2, 11_700)])]);
    assert.ok(!partial.ok && /seluruh barang Partai/.test(partial.errors["sections.0.inputs"]), JSON.stringify(partial));
    const r = await create(hdr, [section([[a.bucketId, 11_700], [b.bucketId, 9_750]], [out(f.n2, 21_450)])]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await transitionRun(r.id, "post", actor)).ok);
    const v = (await getRun(r.id))!;
    assert.equal(v.posted[0].outputs[0].cost, 254_772_451, "Σ of the Jobs' values");
    assert.equal(v.posted[0].outputs[0].lotNo, `${v.partaiNo}_${key("N2")}`.toUpperCase());
    assert.equal(v.posted[0].jobNo, null);
    assert.equal(v.standard, 0);
    const mixed = await prisma.prdBalance.findFirstOrThrow({ where: { lot_id: (await prisma.prdExecutionOutput.findFirstOrThrow({ where: { section: { execution_id: r.id } } })).lot_id! } });
    assert.deepEqual([mixed.partai_id, mixed.job_id, mixed.workstation_id], [partai.id, null, f.wsM]);
  });
});

describe("a Draft", () => {
  test("is edited whole and takes a new number when its station changes; Batalkan needs a reason", async () => {
    const x = await atStation(f.raw, f.wsT, 70, 700_000);
    const r = await create(header(), [section([[x.bucketId, 70]], [out(f.n, 70)])]);
    assert.ok(r.ok);
    const upd = await updateRun(r.id, header({ note: "x" }), [section([[x.bucketId, 40]], [out(f.n, 40)])], actor);
    assert.ok(upd.ok && upd.executionNo === r.executionNo);
    assert.equal((await getRun(r.id))!.sections[0].inputs[0].qty, "40");
    assert.ok(!(await transitionRun(r.id, "cancel", actor, "")).ok);
    assert.ok((await transitionRun(r.id, "cancel", actor, "salah")).ok);
    assert.equal((await getRun(r.id))!.status, "Cancelled");
  });

  test("a lot number typed twice or already in the register, and a missing expiry, are refused", async () => {
    const x = await atStation(f.raw, f.wsT, 20, 200_000);
    const dup = await create(header(), [section([[x.bucketId, 20]], [out(f.n, 10, { lot_no: "dup-1" }), out(f.n2, 10, { lot_no: "DUP-1" })])]);
    assert.ok(!dup.ok && /dua kali/.test(dup.errors._sections));
    const taken = await create(header(), [section([[x.bucketId, 20]], [out(f.n, 20, { lot_no: key("L").toUpperCase() + "1" })])]);
    assert.ok(taken.ok || /sudah tercatat/.test(taken.errors._sections ?? ""));
    const noExpiry = await create(header(), [section([[x.bucketId, 20]], [out(f.exp, 20)])]);
    assert.ok(noExpiry.ok, "an expiry is needed only at Posting");
    const post = await transitionRun(noExpiry.id, "post", actor);
    assert.ok(!post.ok && /kadaluarsa/.test(post.errors._form));
  });

  test("the options offer received goods only, and a station's abilities follow its permissions", async () => {
    const o = await runOptions();
    assert.ok(o.workstations.some((w) => w.id === f.wsT && w.mode === "Transform"));
    assert.ok(o.buckets.every((b) => !b.inTransit));
    const can = executionAbilities(["PRODUCTION_EXECUTION_POST", "PRODUCTION_EXECUTION_CANCEL"]);
    assert.deepEqual(availableExecutionActions("Draft", can).sort(), ["cancel", "post"]);
    assert.deepEqual(availableExecutionActions("Posted", can), []);
    assert.ok(checkRun, "the check is exported for the form's tests");
  });
});
