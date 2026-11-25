import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { advanceToStandBy, consumeBucket, enterProduction, produceIntoBucket, sendInTransit, transferBucket } from "../src/lib/erp/production-ledger";
import { uncostedPeriodRefusal } from "../src/lib/erp/production-close";
import { productionBooksReconcile, productionCardEntriesPage, productionCardReport, productionLots, traceReport, wipBalanceReport } from "../src/lib/erp/production-report";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * The production reports (R18): Saldo Produksi as of a date from the ledger,
 * Kartu Produksi netted per document, Telusur Produksi for a lot; and the year-end guard
 * that reads the same ledger (R28).
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
const yesterday = new Date(date.getTime() - 86_400_000).toISOString().slice(0, 10);
let f: ProductionFixture;
const only = () => ({ unitIds: [f.wsA], itemIds: [] as number[], partaiIds: [] as number[], auxiliary: false });
const filter = () => ({ unitIds: [] as number[], itemIds: [f.material], lotIds: [] as number[] });

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("RP");
  const s = await sourceOf("log_stock_issue", "SI-RP");
  await prisma.$transaction(async (tx) => {
    const { cost } = await issueStock(tx, { itemId: f.material, warehouseId: f.warehouse, lotId: f.lot, baseQty: 500, date, source: s, actorId: f.actor });
    await enterProduction(tx, { lotId: f.lot, itemId: f.material, unitId: f.wsA, baseQty: 500, value: cost, date, source: s, actorId: f.actor });
  });
});

after(async () => {
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Saldo Produksi", () => {
  test("reads the ledger as of a date, per unit and lot", async () => {
    const rows = await wipBalanceReport(today, only());
    assert.deepEqual(rows.map((r) => [r.unit.id, r.item.label, r.qty, r.partai]), [[f.wsA, f.key("BAHAN"), 500, null]]);
    assert.deepEqual(await wipBalanceReport(today, { ...only(), itemIds: [f.product] }), []);
    assert.deepEqual(await wipBalanceReport(yesterday, only()), [], "nothing was in production yesterday");
    assert.ok(await productionBooksReconcile());
  });
});

describe("Kartu Produksi", () => {
  test("a Unit, narrowed to an item: what came in over the period, its opening and its closing", async () => {
    const { cards } = await productionCardReport("unit", filter(), { from: today, to: today });
    assert.deepEqual(cards.map((c) => [c.id, c.entryCount, c.figures.map((x) => [x.uomLabel, x.opening, x.totalIn, x.totalOut, x.closing, x.shrinkage])]), [[f.wsA, 1, [["GR", 0, 500, 0, 500, null]]]]);
    const { entries } = await productionCardEntriesPage("unit", f.wsA, filter(), { from: today, to: today }, null);
    assert.deepEqual(entries.map((e) => [e.text, e.process, e.crossed, e.stages.Preparation]), [["Dari gudang", "Assign", 500, 500]]);
  });

  test("a No. Stok typed in any case; one that does not exist names nothing", async () => {
    const lotNo = (await prisma.logStockTracking.findUniqueOrThrow({ where: { id: f.lot } })).tracking_no;
    assert.deepEqual(await productionLots([lotNo.toLowerCase()]), [{ id: f.lot, no: lotNo, first: today }]);
    assert.deepEqual(await productionLots(["TIDAK-ADA"]), []);
  });
});

describe("Telusur Produksi", () => {
  test("a lot no execution made names its origin and where it is now", async () => {
    const lotNo = (await prisma.logStockTracking.findUniqueOrThrow({ where: { id: f.lot } })).tracking_no;
    const trace = await traceReport(lotNo);
    const start = trace!.start.find((n) => n.lotId === f.lot)!;
    assert.ok(start.origin);
    assert.deepEqual(start.now!.production.map((p) => p.qty), [500]);
    assert.equal(await traceReport("TIDAK-ADA"), null);
  });
});

describe("Saldo Produksi with a backdated movement", () => {
  test("counts it from its own date, and today holds both", async () => {
    const s = await sourceOf("log_stock_issue", "SI-RP-2");
    await prisma.$transaction(async (tx) => {
      const { cost } = await issueStock(tx, { itemId: f.material, warehouseId: f.warehouse, lotId: f.lot, baseQty: 10, date, source: s, actorId: f.actor });
      await enterProduction(tx, { lotId: f.lot, itemId: f.material, unitId: f.wsA, baseQty: 10, value: cost, date: new Date(`${yesterday}T00:00:00Z`), source: s, actorId: f.actor });
    });
    assert.deepEqual((await wipBalanceReport(yesterday, only())).map((r) => r.qty), [10]);
    assert.deepEqual((await wipBalanceReport(today, only())).map((r) => r.qty), [510]);
  });
});

describe("Kartu Produksi reads moves off the stage columns", () => {
  const range = { from: yesterday, to: today };
  const page = (kind: "unit" | "item" | "lot", id: number) => productionCardEntriesPage(kind, id, kind === "unit" ? filter() : { unitIds: [], itemIds: [], lotIds: [] }, range, null);
  const moved = (e: { stages: Record<string, number> }) => Object.entries(e.stages).filter(([, n]) => n);

  test("a stage move crosses nothing; a move between Units is out of one and into the other", async () => {
    const bucket = await prisma.prdBalance.findFirstOrThrow({ where: { tracking_id: f.lot, unit_id: f.wsA } });
    const work = await sourceOf("prd_work", "KRJ-RP");
    const push = await sourceOf("prd_transfer", "PSH-RP");
    await prisma.$transaction(async (tx) => {
      const { toBucketId } = await advanceToStandBy(tx, { bucketId: bucket.id, baseQty: 200, date, source: work, actorId: f.actor });
      await transferBucket(tx, { bucketId: toBucketId, baseQty: 150, date, source: push, actorId: f.actor, toUnitId: f.wsB });
    });
    const { cards } = await productionCardReport("unit", filter(), range);
    assert.deepEqual(
      new Map(cards.map((c) => [c.label, c.figures.map((x) => [x.opening, x.totalIn, x.totalOut, x.worked, x.closing])])),
      new Map([
        [f.key("WSA"), [[0, 510, 150, 0, 360]]],
        [f.key("WSB"), [[0, 150, 0, 0, 150]]],
      ])
    );
    for (const c of cards) {
      const rows = await wipBalanceReport(today, { ...only(), unitIds: [c.id] });
      for (const stage of ["Preparation", "Working", "QcCheck", "StandBy", "InTransit"] as const) {
        assert.equal(rows.filter((r) => r.stage === stage).reduce((s, r) => s + r.qty, 0), c.figures[0].stageClosing[stage], "each stage closes on Saldo Produksi");
      }
    }
    assert.deepEqual((await page("unit", f.wsA)).entries.map((e) => [e.text, e.crossed, moved(e)]), [
      ["Dari gudang", 10, [["Preparation", 10]]],
      ["Dari gudang", 500, [["Preparation", 500]]],
      ["Persiapan → Stand By", 0, [["Preparation", -200], ["StandBy", 200]]],
      [`Ke ${f.key("WSB")}`, -150, [["StandBy", -150]]],
    ]);
    assert.deepEqual((await page("unit", f.wsB)).entries.map((e) => [e.text, e.crossed]), [[`Dari ${f.key("WSA")}`, 150]]);
  });

  test("an item and a No. Stok read across Units, a row in each; a page resumes after its cursor", async () => {
    for (const [kind, id] of [["item", f.material], ["lot", f.lot]] as const) {
      const { cards } = await productionCardReport(kind, { unitIds: [], itemIds: kind === "item" ? [id] : [], lotIds: kind === "lot" ? [id] : [] }, range);
      assert.deepEqual(cards.map((c) => [c.id, c.entryCount, c.figures.map((x) => [x.opening, x.closing])]), [[id, 5, [[0, 510]]]]);
      const { entries } = await page(kind, id);
      assert.deepEqual(entries.slice(3).map((e) => [e.unitLabel, e.crossed]), [[f.key("WSA"), -150], [f.key("WSB"), 150]]);
      const rest = await productionCardEntriesPage(kind, id, { unitIds: [], itemIds: [], lotIds: [] }, range, { date: entries[2].date, id: entries[2].id });
      assert.deepEqual(rest.entries.map((e) => e.id), entries.slice(3).map((e) => e.id));
      if (kind === "lot") assert.equal(cards[0].lot!.now.length, 3, "Persiapan and Stand By at A, Persiapan at B");
    }
  });

  test("susut: what a document consumed and did not produce, on its last row, whatever page it falls on", async () => {
    const bucket = await prisma.prdBalance.findFirstOrThrow({ where: { tracking_id: f.lot, unit_id: f.wsB, stage: "Preparation" } });
    const work = await sourceOf("prd_work", "KRJ-RP-2", 900_500_000);
    const child = await prisma.logStockTracking.create({
      data: {
        ...Object.fromEntries(Object.entries(await prisma.logStockTracking.findUniqueOrThrow({ where: { id: f.lot } })).filter(([k]) => k !== "id")),
        tracking_no: f.key("ANAK"),
        item_id: f.product,
      } as Parameters<typeof prisma.logStockTracking.create>[0]["data"],
    });
    await prisma.$transaction(async (tx) => {
      const taken = await consumeBucket(tx, { bucketId: bucket.id, baseQty: 100, date, source: work, actorId: f.actor });
      await produceIntoBucket(tx, { lotId: child.id, itemId: f.product, unitId: f.wsB, afterStepId: taken.stepId!, partaiId: null, jobId: null, baseQty: 97, value: taken.value, date, source: work, actorId: f.actor });
    });
    const all = { unitIds: [f.wsB], itemIds: [], lotIds: [] };
    const { cards } = await productionCardReport("unit", all, range);
    assert.deepEqual(cards[0].figures.map((x) => [x.opening, x.totalIn, x.totalOut, x.shrinkage, x.converted, x.closing]), [[0, 150, 0, 3, 0, 147]]);
    const { entries } = await productionCardEntriesPage("unit", f.wsB, all, range, null);
    assert.deepEqual(entries.map((e) => [e.lotNo === f.key("ANAK"), e.crossed, e.shrinkage]), [[false, 150, null], [false, 0, null], [true, 0, 3]]);
    const rest = await productionCardEntriesPage("unit", f.wsB, all, range, { date: entries[1].date, id: entries[1].id });
    assert.deepEqual(rest.entries.map((e) => e.shrinkage), [3], "a page that splits the document still knows its susut");
    // Part of the document is hidden by an item filter, so nothing is said.
    const narrowed = await productionCardReport("unit", { ...all, itemIds: [f.product] }, range);
    assert.deepEqual(narrowed.cards[0].figures.map((x) => [x.shrinkage, x.worked, x.closing]), [[null, 97, 97]]);
  });

  test("goods Dalam Perjalanan stay at the sender", async () => {
    const bucket = await prisma.prdBalance.findFirstOrThrow({ where: { tracking_id: f.lot, unit_id: f.wsA, stage: "StandBy" } });
    const bstb = await sourceOf("prd_transfer", "BST-RP", 900_600_000);
    await prisma.$transaction((tx) => sendInTransit(tx, { bucketId: bucket.id, baseQty: 20, date, source: bstb, doc: bstb, actorId: f.actor }));
    const rows = await wipBalanceReport(today, only());
    assert.deepEqual(rows.filter((r) => r.stage === "InTransit").map((r) => r.qty), [20]);
    const sent = (await page("unit", f.wsA)).entries.at(-1)!;
    assert.deepEqual([sent.text, sent.crossed, moved(sent)], ["Stand By → Dalam Perjalanan", 0, [["StandBy", -20], ["InTransit", 20]]]);
  });
});

describe("the year-end guard (R28)", () => {
  test("a period with a production movement refuses until it is costed", async () => {
    const period = await prisma.accFiscalPeriod.findFirstOrThrow({ where: { start_date: { lte: date }, end_date: { gte: date } } });
    assert.match((await uncostedPeriodRefusal(period.fiscal_year_id)) ?? "", /belum ditutup biayanya/);
  });
});
