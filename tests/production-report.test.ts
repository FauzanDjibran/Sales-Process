import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { enterProduction } from "../src/lib/erp/production-ledger";
import { lotCardReport, productionBooksReconcile, runRecapReport, wipBalanceReport } from "../src/lib/erp/production-report";
import { createExecution, transitionExecution } from "../src/lib/erp/production-run";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * The production reports (R18): Saldo Produksi as of a date from the ledger,
 * Kartu Lot over both books, Rekap Produksi per workstation and unit.
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
const yesterday = new Date(date.getTime() - 86_400_000).toISOString().slice(0, 10);
let f: ProductionFixture;
const ids: number[] = [];

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("RP");
  const s = await sourceOf("log_stock_issue", "SI-RP");
  const bucket = await prisma.$transaction(async (tx) => {
    const { cost } = await issueStock(tx, { itemId: f.material, warehouseId: f.warehouse, lotId: f.lot, baseQty: 500, date, source: s, actorId: f.actor });
    return (await enterProduction(tx, { lotId: f.lot, itemId: f.material, workstationId: f.wsA, baseQty: 500, value: cost, date, source: s, actorId: f.actor })).bucketId;
  });
  const r = await createExecution(
    {
      execution_date: today,
      workstation_id: f.wsA,
      driver: "8",
      note: "",
      inputs: [{ bucket_id: bucket, qty: "400" }],
      outputs: [
        { item_id: f.product, lot_no: "", expiry_date: "", qty: "300" },
        { item_id: f.byproduct, lot_no: "", expiry_date: "", qty: "50" },
      ],
    },
    f.actor,
  );
  assert.ok(r.ok, JSON.stringify(r));
  ids.push(r.id);
  assert.ok((await transitionExecution(r.id, "post", f.actor)).ok);
});

after(async () => {
  await prisma.prdExecution.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_execution", row_id: { in: ids } } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("Saldo Produksi", () => {
  test("reads the ledger as of a date, per workstation and lot", async () => {
    const [block] = await wipBalanceReport(today, [f.wsA]);
    assert.ok(block);
    const rows = block.rows.map((r) => [r.itemLabel, r.qty, r.value]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    assert.deepEqual(rows, [
      [f.key("BAHAN"), 100, 100_000],
      [f.key("PRODUK"), 300, 400_000],
      [f.key("SISA"), 50, 0],
    ]);
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
      ["Consumed", -400, 100, 100_000],
    ]);
    assert.deepEqual(card.inStock.map((m) => m.qtyChange), [1_000, -500]);
  });
});

describe("Rekap Produksi", () => {
  test("in, out and the loss per workstation and unit", async () => {
    const [st] = await runRecapReport({ from: today, to: today }, [f.wsA]);
    assert.equal(st.runs, 1);
    assert.equal(st.driver, 8);
    assert.deepEqual(
      st.rows.map((r) => [r.inQty, r.outQty, r.loss, r.lossPct, r.inValue, r.outValue]),
      [[400, 350, 50, 12.5, 400_000, 400_000]],
    );
  });
});
