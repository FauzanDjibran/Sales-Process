import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { issueStock } from "../src/lib/erp/inventory";
import { postJournal } from "../src/lib/erp/journal";
import { costingSoFar, previewClose, runClose, storedClose } from "../src/lib/erp/production-close";
import { settleClose } from "../src/lib/erp/production-close-shape";
import { enterProduction, transferBucket } from "../src/lib/erp/production-ledger";
import { createRelease, transitionRelease } from "../src/lib/erp/production-release";
import { createExecution, getExecution, transitionExecution, type ExecutionInput } from "../src/lib/erp/production-run";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma, stockIn } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * Penutupan Biaya Produksi (R10–R15, R25) on the plan's scenario G1
 * (`Production-Plan.md` §4.1), in March 2001 so the period has ended and no
 * other data shares it: WIP carries material only until the close, which
 * shares the pool by Driver and follows it forward to WIP, HPP and stock,
 * credits Biaya Produksi Dibebankan, stores what it closed and locks the period.
 */

const at = (d: string) => new Date(`2001-03-${d}T00:00:00Z`);
let f: ProductionFixture;
let fg = 0;
let bbItem = 0;
let bkItem = 0;
let expenseAcc = 0;
let otherAcc = 0;
let absorbedAcc = 0;
let costType = 0;
let periodId = 0;
let fgLot = 0;
const runs: number[] = [];
const releases: number[] = [];
const saved = new Map<string, string | null>();

async function setting(key: string, value: number) {
  saved.set(key, (await prisma.sysSetting.findUnique({ where: { setting_key: key } }))?.setting_value ?? null);
  await prisma.sysSetting.upsert({ where: { setting_key: key }, update: { setting_value: String(value) }, create: { setting_key: key, setting_value: String(value), updated_by: f.actor } });
}

const exec = async (input: ExecutionInput) => {
  const r = await createExecution(input, f.actor);
  assert.ok(r.ok, JSON.stringify(r));
  runs.push(r.id);
  const p = await transitionExecution(r.id, "post", f.actor);
  assert.ok(p.ok, JSON.stringify(p));
  return (await getExecution(r.id))!;
};

const outputLot = (executionId: number) => prisma.prdExecutionOutput.findFirstOrThrow({ where: { execution_id: executionId } }).then((o) => o.lot_id!);
const bucketOf = (lotId: number, workstationId: number) => prisma.prdBalance.findFirstOrThrow({ where: { lot_id: lotId, workstation_id: workstationId } }).then((b) => b.id);

before(async () => {
  await openFiscalYear(at("15"));
  periodId = (await prisma.accFiscalPeriod.findFirstOrThrow({ where: { start_date: at("01") } })).id;
  f = await makeProductionFixture("CL");
  // Items of the test's own, so no other stock shares their moving-average pools.
  const item = async (label: string, weight: number | null) =>
    (await prisma.mItem.create({ data: { item_code: `test.${f.key(label)}`, item_label: f.key(label), item_name: label, item_type: "Barang", category_id: f.category, base_uom_id: f.uom, track_stock: true, value_weight: weight, created_by: f.actor } })).id;
  fg = await item("FG", 1);
  bbItem = await item("BB", null);
  bkItem = await item("BK", null);
  expenseAcc = await makeAccount({ subcategoryLabel: "5.1.9" });
  otherAcc = await makeAccount({ subcategoryLabel: "2.1.1" });
  absorbedAcc = await makeAccount({ subcategoryLabel: "5.1.9", normalBalance: "Kredit" });
  costType = (await prisma.accCostType.create({ data: { cost_type_code: `test.${f.key("JB")}`, cost_type_label: f.key("JB"), cost_type_name: "Biaya Uji", expense_account_id: expenseAcc, created_by: f.actor } })).id;
  await setting("production_absorbed_account", absorbedAcc);
  await setting("cogs_account", f.scrapAcc);
  await setting("production_scrap_account", f.scrapAcc);

  // BB-1 100 @ Rp10.000 and BK-1 200 @ Rp1.000 in stock on 1 March.
  const bb = await stockIn(bbItem, f.warehouse, f.key("BB1"), 100, 1_000_000, null, "2001-03-01");
  const bk = await stockIn(bkItem, f.warehouse, f.key("BK1"), 200, 200_000, null, "2001-03-01");
  const issue = async (lotId: number, itemId: number, qty: number, ws: number, d: string) => {
    const s = await sourceOf("log_stock_issue", `SI-CL-${d}-${itemId}`);
    return prisma.$transaction(async (tx) => {
      const { cost } = await issueStock(tx, { itemId, warehouseId: f.warehouse, lotId, baseQty: qty, date: at(d), source: s, actorId: f.actor });
      return (await enterProduction(tx, { lotId, itemId, workstationId: ws, baseQty: qty, value: cost, date: at(d), source: s, actorId: f.actor })).bucketId;
    });
  };
  const bbBucket = await issue(bb, bbItem, 100, f.wsA, "02");

  // EKS-1 at WS-A (Driver 10): 100 kg → 80 of the semi-finished product.
  const e1 = await exec({ execution_date: "2001-03-03", workstation_id: f.wsA, driver: "10", note: "", inputs: [{ bucket_id: bbBucket, qty: "100" }], outputs: [{ item_id: f.product, lot_no: "", expiry_date: "", qty: "80" }] });
  const sjLot = await outputLot(e1.id);
  const sjAtA = await bucketOf(sjLot, f.wsA);
  const t = await sourceOf("prd_transfer", "PT-CL");
  await prisma.$transaction((tx) => transferBucket(tx, { bucketId: sjAtA, baseQty: 80, toWorkstationId: f.wsB, date: at("04"), source: t, actorId: f.actor }));
  const bkBucket = await issue(bk, bkItem, 200, f.wsB, "05");

  // EKS-2 at WS-B (Driver 30): the semi-finished + packaging → FG-1 200.
  const e2 = await exec({
    execution_date: "2001-03-06",
    workstation_id: f.wsB,
    driver: "30",
    note: "",
    inputs: [
      { bucket_id: await bucketOf(sjLot, f.wsB), qty: "80" },
      { bucket_id: bkBucket, qty: "200" },
    ],
    outputs: [{ item_id: fg, lot_no: "", expiry_date: "", qty: "200" }],
  });
  fgLot = await outputLot(e2.id);
  assert.equal(e2.value, 1_200_000);

  // Release 100 to stock, sell 50 of them.
  const rel = await createRelease({ purpose: "to_stock", release_date: "2001-03-20", workstation_id: f.wsB, warehouse_id: f.warehouse, location_id: null, scrap_reason: "", note: "", lines: [{ bucket_id: await bucketOf(fgLot, f.wsB), qty: "100" }] }, f.actor);
  assert.ok(rel.ok, JSON.stringify(rel));
  releases.push(rel.id);
  assert.ok((await transitionRelease(rel.id, "post", f.actor)).ok);
  const sale = await sourceOf("log_delivery_note", "SJ-CL");
  await prisma.$transaction((tx) => issueStock(tx, { itemId: fg, warehouseId: f.warehouse, lotId: fgLot, baseQty: 50, date: at("25"), source: sale, actorId: f.actor }));

  // The month's cost: Rp400.000 on the Jenis Biaya's account.
  const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  await prisma.$transaction((tx) =>
    postJournal(tx, {
      description: "Biaya uji",
      postingDate: at("15"),
      actorId: f.actor,
      lines: [
        { accountId: expenseAcc, currencyId: currency, rate: 1, debit: 400_000, credit: 0, description: "uji" },
        { accountId: otherAcc, currencyId: currency, rate: 1, debit: 0, credit: 400_000, description: "uji" },
      ],
    })
  );
});

after(async () => {
  const close = await prisma.prdCostClose.findUnique({ where: { period_id: periodId } });
  if (close) {
    await prisma.prdCostClose.delete({ where: { id: close.id } });
    await prisma.auditLog.deleteMany({ where: { entity_key: "prd_cost_close", row_id: close.id } });
  }
  await prisma.accFiscalPeriodLock.deleteMany({ where: { period_id: periodId } });
  await prisma.accFiscalPeriod.updateMany({ where: { id: periodId }, data: { production_costed_at: null, production_costed_by: null } });
  await prisma.prdExecution.deleteMany({ where: { id: { in: runs } } });
  await prisma.prdRelease.deleteMany({ where: { id: { in: releases } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: { in: ["prd_execution", "prd_release"] }, row_id: { in: [...runs, ...releases] } } });
  for (const [key, value] of saved) {
    if (value === null) await prisma.sysSetting.deleteMany({ where: { setting_key: key } });
    else await prisma.sysSetting.update({ where: { setting_key: key }, data: { setting_value: value } });
  }
  await prisma.accCostType.deleteMany({ where: { id: costType } });
  const items = [fg, bbItem, bkItem];
  const lots = (await prisma.logStockTracking.findMany({ where: { item_id: { in: items } }, select: { id: true } })).map((l) => l.id);
  await prisma.prdLotLink.deleteMany({ where: { OR: [{ from_lot_id: { in: lots } }, { to_lot_id: { in: lots } }] } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  await prisma.logStockLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.logStockBalance.deleteMany({ where: { item_id: { in: items } } });
  await prisma.logStockValuationLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.logStockValuationBalance.deleteMany({ where: { item_id: { in: items } } });
  await prisma.logStockTracking.deleteMany({ where: { item_id: { in: items } } });
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("the arithmetic (pure)", () => {
  test("a pool with no execution is HPP (R14); every rupiah lands somewhere", () => {
    const out = settleClose({ pool: 1_000, runs: [], fate: () => ({ held: [], links: [], released: [] }), releasePurpose: () => "to_stock", flows: () => ({ opening: 0, inflow: 0, outflow: 0, poolQty: 0 }) });
    assert.deepEqual(out.dests, [{ kind: "Hpp", itemId: null, bucketId: null, amount: 1_000 }]);
  });
});

describe("the close of scenario G1", () => {
  test("before it, WIP and stock carry material only", async () => {
    const wip = await prisma.prdBalance.findFirstOrThrow({ where: { lot_id: fgLot, workstation_id: f.wsB } });
    assert.equal(wip.value_balance.toNumber(), 600_000);
    const pool = await prisma.logStockValuationBalance.findUniqueOrThrow({ where: { item_id: fg } });
    assert.equal(pool.value_balance.toNumber(), 300_000);
  });

  test("the preview shares the pool by Driver and follows it forward", async () => {
    const p = (await previewClose(periodId))!;
    assert.deepEqual(p.blockers, []);
    assert.equal(p.figures.pool, 400_000);
    assert.deepEqual(p.figures.out.shares.map((s) => s.amount), [100_000, 300_000]);
    const by = Object.fromEntries(p.figures.dests.map((d) => [d.kind, d.amount]));
    assert.deepEqual(by, { Wip: 200_000, Hpp: 100_000, Stock: 100_000 });
    const dry = await runClose(periodId, f.actor, { dryRun: true });
    assert.ok(dry.ok);
    if (dry.ok) assert.equal(dry.journal.find((l) => l.accountId === absorbedAcc)?.credit, 400_000);
    assert.equal(await prisma.prdCostClose.count({ where: { period_id: periodId } }), 0, "the dry run wrote nothing");
  });

  test("the close posts, revalues, stores what it closed and locks the period", async () => {
    // Costing Sementara on the last day (R26) is the close it then posts, figure for figure.
    const soFar = (await costingSoFar("2001-03-31"))!;
    assert.deepEqual(soFar.items.map((i) => [i.share, i.hpp, i.stock, i.postedValue, i.finalValue, i.finalUnitCost]), [[200_000, 100_000, 100_000, 300_000, 400_000, 8_000]]);
    const r = await runClose(periodId, f.actor);
    assert.ok(r.ok, JSON.stringify(r));
    const after = (await storedClose(periodId))!;
    assert.equal(after.poolTotal, soFar.view.poolTotal);
    assert.deepEqual(after.shares, soFar.view.shares);
    assert.deepEqual(after.dests, soFar.view.dests);
    assert.deepEqual(after.items, soFar.view.items);
    const wip = await prisma.prdBalance.findFirstOrThrow({ where: { lot_id: fgLot, workstation_id: f.wsB } });
    assert.equal(wip.value_balance.toNumber(), 800_000);
    const pool = await prisma.logStockValuationBalance.findUniqueOrThrow({ where: { item_id: fg } });
    assert.equal(pool.value_balance.toNumber(), 400_000);

    const stored = (await storedClose(periodId))!;
    assert.equal(stored.poolTotal, 400_000);
    assert.deepEqual(stored.items.map((i) => [i.inflowQty, i.outflowQty, i.endingQty, i.hpp, i.stock]), [[100, 50, 50, 100_000, 100_000]]);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: stored.journalId! } });
    const net = (acc: number) => lines.filter((l) => l.account_id === acc).reduce((a, l) => a + l.debit_amount.toNumber() - l.kredit_amount.toNumber(), 0);
    assert.equal(net(absorbedAcc), -400_000);
    assert.equal(net(f.wipAcc), 200_000);
    assert.equal(net(f.inventoryAcc), 100_000);
    assert.equal(net(f.scrapAcc), 100_000);

    // Locked (R15): stock, production and the pool's accounts; other accounts still post.
    const late = await sourceOf("log_delivery_note", "SJ-CL-LATE");
    await assert.rejects(prisma.$transaction((tx) => issueStock(tx, { itemId: fg, warehouseId: f.warehouse, lotId: fgLot, baseQty: 1, date: at("28"), source: late, actorId: f.actor })), /sudah ditutup biayanya/);
    const currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
    const j = (acc: number) =>
      prisma.$transaction((tx) => postJournal(tx, { description: "uji", postingDate: at("28"), actorId: f.actor, lines: [{ accountId: acc, currencyId: currency, rate: 1, debit: 1, credit: 0, description: "" }, { accountId: otherAcc, currencyId: currency, rate: 1, debit: 0, credit: 1, description: "" }] }));
    await assert.rejects(j(expenseAcc), /sudah ditutup biayanya/);
    await j(f.inventoryAcc);
    assert.ok(!(await runClose(periodId, f.actor)).ok, "a period closes once");
  });
});
