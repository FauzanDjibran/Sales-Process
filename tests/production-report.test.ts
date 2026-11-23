import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { advanceToStandBy, enterProduction, transferBucket } from "../src/lib/erp/production-ledger";
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
  test("an item in a Unit: what came in over the period, its opening and its closing", async () => {
    const { cards } = await productionCardReport("unit", filter(), { from: today, to: today }, false);
    assert.deepEqual(cards.map((c) => [c.item.id, c.unit?.id, c.opening, c.totalIn, c.totalOut, c.closing, c.entryCount]), [[f.material, f.wsA, 0, 500, 0, 500, 1]]);
    const { entries } = await productionCardEntriesPage("unit", { itemId: f.material, ofId: f.wsA }, filter(), { from: today, to: today }, false, null);
    assert.deepEqual(entries.map((e) => [e.text, e.change]), [["Dari gudang", 500]]);
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

describe("Kartu Produksi nets moves inside a Unit", () => {
  const range = { from: yesterday, to: today };
  const page = (kind: "unit" | "lot", ofId: number, stages: boolean) => productionCardEntriesPage(kind, { itemId: f.material, ofId }, filter(), range, stages, null);

  test("a stage move counts as neither in nor out; a move between Units is out of one and into the other", async () => {
    const bucket = await prisma.prdBalance.findFirstOrThrow({ where: { tracking_id: f.lot, unit_id: f.wsA } });
    const work = await sourceOf("prd_work", "KRJ-RP");
    const push = await sourceOf("prd_transfer", "PSH-RP");
    await prisma.$transaction(async (tx) => {
      const { toBucketId } = await advanceToStandBy(tx, { bucketId: bucket.id, baseQty: 200, date, source: work, actorId: f.actor });
      await transferBucket(tx, { bucketId: toBucketId, baseQty: 150, date, source: push, actorId: f.actor, toUnitId: f.wsB });
    });
    const { cards } = await productionCardReport("unit", filter(), range, false);
    assert.deepEqual(cards.map((c) => [c.unit!.label, c.opening, c.totalIn, c.totalOut, c.closing]), [
      [f.key("WSA"), 0, 510, 150, 360],
      [f.key("WSB"), 0, 150, 0, 150],
    ]);
    for (const c of cards) {
      const rows = await wipBalanceReport(today, { ...only(), unitIds: [c.unit!.id] });
      assert.equal(rows.reduce((s, r) => s + r.qty, 0), c.closing, "the card closes on Saldo Produksi");
    }
    assert.deepEqual((await page("unit", f.wsA, false)).entries.map((e) => [e.text, e.change]), [
      ["Dari gudang", 10],
      ["Dari gudang", 500],
      [`Ke ${f.key("WSB")}`, -150],
    ]);
    assert.deepEqual((await page("unit", f.wsB, false)).entries.map((e) => [e.text, e.change]), [[`Dari ${f.key("WSA")}`, 150]]);
    // With the stages shown the move is a row of its own and no figure changes.
    const withStages = (await page("unit", f.wsA, true)).entries;
    assert.deepEqual(withStages.map((e) => e.change), [10, 500, 0, -150]);
    assert.equal(withStages[2].stages, "Persiapan Assign → Stand By");
  });

  test("a No. Stok across Units: a Push is one row without a figure, and a page resumes after its cursor", async () => {
    const { cards } = await productionCardReport("lot", { ...filter(), lotIds: [f.lot] }, range, false);
    assert.deepEqual(cards.map((c) => [c.lot!.sourceNo !== "", c.totalIn, c.totalOut, c.closing, c.entryCount]), [[true, 510, 0, 510, 3]]);
    assert.equal(cards[0].lot!.now.length, 3, "Persiapan and Stand By at A, Persiapan at B");
    const { entries } = await page("lot", f.lot, false);
    assert.deepEqual(entries.map((e) => [e.text, e.change]), [
      ["Dari gudang", 10],
      ["Dari gudang", 500],
      [`${f.key("WSA")} → ${f.key("WSB")}`, 0],
    ]);
    const rest = await productionCardEntriesPage("lot", { itemId: f.material, ofId: f.lot }, filter(), range, false, { date: entries[1].date, id: entries[1].id });
    assert.deepEqual(rest.entries.map((e) => e.id), [entries[2].id]);
  });
});

describe("the year-end guard (R28)", () => {
  test("a period with a production movement refuses until it is costed", async () => {
    const period = await prisma.accFiscalPeriod.findFirstOrThrow({ where: { start_date: { lte: date }, end_date: { gte: date } } });
    assert.match((await uncostedPeriodRefusal(period.fiscal_year_id)) ?? "", /belum ditutup biayanya/);
  });
});
