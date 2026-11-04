import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { enterProduction } from "../src/lib/erp/production-ledger";
import { uncostedPeriodRefusal } from "../src/lib/erp/production-close";
import { lotCardReport, productionBooksReconcile, traceReport, wipBalanceReport } from "../src/lib/erp/production-report";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * The production reports (R18): Saldo Produksi as of a date from the ledger,
 * Kartu Lot over both books, Telusur Produksi for a lot; and the year-end guard
 * that reads the same ledger (R28).
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
const yesterday = new Date(date.getTime() - 86_400_000).toISOString().slice(0, 10);
let f: ProductionFixture;

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
    const [block] = await wipBalanceReport(today, [f.wsA]);
    assert.ok(block);
    assert.deepEqual(block.rows.map((r) => [r.itemLabel, r.qty, r.value]), [[f.key("BAHAN"), 500, 500_000]]);
    assert.equal(block.value, 500_000);
    assert.deepEqual(await wipBalanceReport(yesterday, [f.wsA]), [], "nothing was in production yesterday");
    assert.ok(await productionBooksReconcile());
  });
});

describe("Kartu Lot", () => {
  test("shows the lot in production and in stock", async () => {
    const lotNo = (await prisma.logStockTracking.findUniqueOrThrow({ where: { id: f.lot } })).tracking_no;
    const [card] = (await lotCardReport(lotNo.toLowerCase())).filter((c) => c.lotId === f.lot);
    assert.ok(card);
    assert.deepEqual(card.inProduction.map((m) => [m.movement, m.qtyChange, m.qtyBalance, m.valueBalance]), [
      ["Issued", 500, 500, 500_000],
    ]);
    assert.deepEqual(card.inStock.map((m) => m.qtyChange), [1_000, -500]);
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

describe("the year-end guard (R28)", () => {
  test("a period with a production movement refuses until it is costed", async () => {
    const period = await prisma.accFiscalPeriod.findFirstOrThrow({ where: { start_date: { lte: date }, end_date: { gte: date } } });
    assert.match((await uncostedPeriodRefusal(period.fiscal_year_id)) ?? "", /belum ditutup biayanya/);
  });
});
