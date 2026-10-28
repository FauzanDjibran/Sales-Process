import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { settleClose, type CloseInput } from "../src/lib/erp/production-close-shape";
import type { LotFate } from "../src/lib/erp/production-ledger";
import { InventoryRefusal, revaluePool } from "../src/lib/erp/inventory";
import { CostCenterRefusal, postJournal } from "../src/lib/erp/journal";
import { costedPeriodRefusal } from "../src/lib/erp/fiscal";
import { previewClose, runClose } from "../src/lib/erp/production-close";
import { createRun, transitionRun, type RunOutputLine } from "../src/lib/erp/production-run";
import { enterProduction, ProductionRefusal } from "../src/lib/erp/production-ledger";
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
 * Penutupan Biaya Produksi (Walet step 8, P172, M96–M99). The arithmetic is pure
 * (`production-close-shape.ts`) and is proved on its own: the Driver split with a
 * largest remainder, the Overhead spread Rata, an idle Cost Center, no execution
 * at all, the follow-forward through the lots and the stock split of M27. The
 * posting is proved on a fiscal year of 2001 that only this suite writes into, so
 * no other data can block or join its close: value-only rows, one journal, every
 * Production Cost Center at 0, the lock — and the locked period refusing a
 * stock, a production and a Cost Center posting.
 */

// ------------------------------------------------------------------- the arithmetic

const NONE: LotFate = { held: [], links: [], released: [] };
const held = (bucketId: number, qty: number, itemId = 1): LotFate => ({ held: [{ bucketId, itemId, qty }], links: [], released: [] });
const base = (over: Partial<CloseInput>): CloseInput => ({
  pools: [],
  overheadCostCenterId: null,
  runs: [],
  fate: () => NONE,
  releasePurpose: () => "finished_receipt",
  flows: () => ({ opening: 0, inflow: 0, outflow: 0, poolQty: 0 }),
  ...over,
});
const total = (r: ReturnType<typeof settleClose>) => r.dests.reduce((a, d) => a + d.amount, 0);

describe("the leftover is shared by Driver and followed to where the value is", () => {
  test("a pool of 600.000 over Drivers 3 and 1: WIP for one, stock split sold / ending for the other (M27)", () => {
    const r = settleClose(
      base({
        pools: [{ costCenterId: 1, itemId: 7, accountId: 70, actual: 1_000_000, standard: 400_000 }],
        runs: [
          { id: 1, costCenterId: 1, driver: 3, outputs: [{ lotId: 10, weight: 1, qty: 10 }] },
          { id: 2, costCenterId: 1, driver: 1, outputs: [{ lotId: 20, weight: 1, qty: 10 }] },
        ],
        fate: (l) => (l === 10 ? held(11, 10) : { held: [], links: [], released: [{ docTypeId: 1, docId: 5, itemId: 9, qty: 10 }] }),
        flows: () => ({ opening: 0, inflow: 10, outflow: 5, poolQty: 5 }),
      })
    );
    assert.equal(r.pools[0].leftover, 600_000);
    assert.deepEqual(r.shares.map((s) => s.amount), [450_000, 150_000]);
    const by = (kind: string) => r.dests.filter((d) => d.kind === kind);
    assert.equal(by("Wip")[0].amount, 450_000);
    assert.equal(by("Wip")[0].bucketId, 11);
    assert.equal(by("Hpp")[0].amount, 75_000, "half of the goods available were sold");
    assert.equal(by("Stock")[0].amount, 75_000, "the rest stays in the pool");
    assert.equal(total(r), 600_000, "every rupiah lands somewhere");
  });

  test("a lot passes its share on in proportion to quantity — to what holds it and to a later execution's lot", () => {
    const r = settleClose(
      base({
        pools: [{ costCenterId: 1, itemId: 7, accountId: 70, actual: 400_000, standard: 0 }],
        runs: [{ id: 1, costCenterId: 1, driver: 1, outputs: [{ lotId: 10, weight: 5, qty: 100 }] }],
        fate: (l) => (l === 10 ? { held: [{ bucketId: 11, itemId: 1, qty: 25 }], links: [{ toLotId: 30, qty: 75 }], released: [] } : held(12, 75)),
      })
    );
    assert.deepEqual(
      r.dests.map((d) => [d.bucketId, d.amount]).sort(),
      [[11, 100_000], [12, 300_000]]
    );
  });

  test("a scrap release takes its share to the scrap expense; a lot with no fate falls to HPP", () => {
    const r = settleClose(
      base({
        pools: [{ costCenterId: 1, itemId: 7, accountId: 70, actual: 90_000, standard: 0 }],
        runs: [
          { id: 1, costCenterId: 1, driver: 1, outputs: [{ lotId: 10, weight: 1, qty: 1 }] },
          { id: 2, costCenterId: 1, driver: 2, outputs: [{ lotId: 20, weight: 1, qty: 1 }] },
        ],
        fate: (l) => (l === 10 ? { held: [], links: [], released: [{ docTypeId: 1, docId: 9, itemId: 4, qty: 3 }] } : NONE),
        releasePurpose: () => "scrap",
      })
    );
    assert.equal(r.dests.find((d) => d.kind === "Scrap")!.amount, 30_000);
    assert.equal(r.dests.find((d) => d.kind === "Hpp")!.amount, 60_000);
  });

  test("a standard that over-absorbed leaves a negative leftover, taken out of WIP", () => {
    const r = settleClose(
      base({
        pools: [{ costCenterId: 1, itemId: 7, accountId: 70, actual: 100_000, standard: 300_000 }],
        runs: [{ id: 1, costCenterId: 1, driver: 4, outputs: [{ lotId: 10, weight: 1, qty: 1 }] }],
        fate: () => held(11, 1),
      })
    );
    assert.equal(r.pools[0].leftover, -200_000);
    assert.equal(r.dests[0].amount, -200_000);
  });

  test("the same result with or without a standard: the rate cancels (§4.4)", () => {
    const run = (standard: number) =>
      settleClose(
        base({
          pools: [{ costCenterId: 1, itemId: 7, accountId: 70, actual: 900_000, standard }],
          runs: [
            { id: 1, costCenterId: 1, driver: 2, outputs: [{ lotId: 10, weight: 1, qty: 1 }] },
            { id: 2, costCenterId: 1, driver: 1, outputs: [{ lotId: 20, weight: 1, qty: 1 }] },
          ],
          fate: (l) => held(l, 1),
        })
      );
    // Each execution ends with pool × its Driver ÷ total Driver once the standard booked at execution is added back.
    const without = run(0).shares.map((s) => s.amount);
    const withStd = run(540_000).shares.map((s) => s.amount);
    assert.deepEqual(without, [600_000, 300_000]);
    assert.deepEqual(withStd, [240_000, 120_000]);
    assert.deepEqual(withStd.map((a, i) => a + [360_000, 180_000][i]), without);
  });
});

describe("the Overhead, a Cost Center with no Driver, and a month with no execution", () => {
  test("the Overhead is spread Rata over the Production Cost Centers that ran, the first taking the odd rupiah", () => {
    const r = settleClose(
      base({
        overheadCostCenterId: 9,
        pools: [{ costCenterId: 9, itemId: 7, accountId: 70, actual: 300_001, standard: 0 }],
        runs: [
          { id: 1, costCenterId: 1, driver: 1, outputs: [{ lotId: 10, weight: 1, qty: 1 }] },
          { id: 2, costCenterId: 2, driver: 5, outputs: [{ lotId: 20, weight: 1, qty: 1 }] },
        ],
        fate: (l) => held(l, 1),
      })
    );
    const ovh = r.pools.find((p) => p.costCenterId === 9)!;
    assert.equal(ovh.overhead, -300_001, "the Overhead gives it all away");
    assert.deepEqual(r.pools.filter((p) => p.costCenterId !== 9).map((p) => p.overhead), [150_001, 150_000]);
    assert.deepEqual(r.shares.map((s) => s.amount), [150_001, 150_000]);
    assert.equal(total(r), 300_001);
  });

  test("a Cost Center with a balance and no Driver is shared by what the executions took, else by Driver", () => {
    const r = settleClose(
      base({
        pools: [
          { costCenterId: 1, itemId: 7, accountId: 70, actual: 500_000, standard: 0 },
          { costCenterId: 2, itemId: 7, accountId: 70, actual: 100_000, standard: 0 },
        ],
        runs: [
          { id: 1, costCenterId: 2, driver: 1, outputs: [{ lotId: 10, weight: 1, qty: 1 }] },
          { id: 2, costCenterId: 2, driver: 1, outputs: [{ lotId: 20, weight: 1, qty: 1 }] },
        ],
        fate: (l) => held(l, 1),
      })
    );
    assert.deepEqual(r.shares.map((s) => s.amount), [300_000, 300_000]);
    assert.equal(total(r), 600_000);
  });

  test("with no execution at all the whole balance goes to HPP", () => {
    const r = settleClose(base({ pools: [{ costCenterId: 1, itemId: 7, accountId: 70, actual: 500_000, standard: 0 }] }));
    assert.deepEqual(r.dests, [{ kind: "Hpp", itemId: null, bucketId: null, amount: 500_000 }]);
  });

  test("an output with no Bobot Biaya takes the share by quantity; one with nothing at all falls to HPP", () => {
    const r = settleClose(
      base({
        pools: [{ costCenterId: 1, itemId: 7, accountId: 70, actual: 100_000, standard: 0 }],
        runs: [{ id: 1, costCenterId: 1, driver: 1, outputs: [{ lotId: 10, weight: 0, qty: 1 }, { lotId: 20, weight: 0, qty: 3 }] }],
        fate: (l) => held(l, 1),
      })
    );
    assert.deepEqual(r.dests.map((d) => [d.bucketId, d.amount]).sort(), [[10, 25_000], [20, 75_000]]);
  });
});

// ------------------------------------------------------------------- the posting

const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const closeDay = "2001-03-10";
const day = new Date(`${closeDay}T00:00:00Z`);
let actor = 0;
const f = {} as Record<string, number>;
const runs: number[] = [];
const items: number[] = [];
const cleanups: (() => Promise<unknown>)[] = [];
let fakeDoc = 900_000 + (Date.now() % 90_000);
let periodId = 0;

before(async () => {
  actor = await systemUserId();
  await openFiscalYear(new Date("2001-03-15T00:00:00Z"));
  periodId = (await prisma.accFiscalPeriod.findFirstOrThrow({ where: { start_date: { lte: day }, end_date: { gte: day } } })).id;
  const cc = await productionCostCenterId();
  f.cc = cc;
  f.currency = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.g = (await prisma.refUom.create({ data: { uom_code: `test.${key("G")}`, uom_label: key("G"), uom_name: "Gram", created_by: actor } })).id;
  f.cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BHN-BAKU" } })).id;
  const item = async (l: string) => {
    const id = (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: f.cat, base_uom_id: f.g, track_stock: true, output_type: "Utama", created_by: actor },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.raw = await item("RAW");
  f.n = await item("N");
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang", created_by: actor } })).id;
  f.ws = (await prisma.refWorkstation.create({ data: { workstation_code: `test.${key("WS")}`, workstation_label: key("WS"), workstation_name: "WS", cost_center_id: cc, mode: "Transform", created_by: actor } })).id;

  f.wipAcc = await makeAccount({ subcategoryLabel: "1.1.1" });
  cleanups.push(await snapshotCategoryAccounts([f.cat]));
  await setCategoryAccount(f.cat, "Wip", f.wipAcc, actor);
  f.stdAcc = await makeAccount({ subcategoryLabel: "5.1.1", requireCostCenter: true, normalBalance: "Kredit" });
  f.stdItem = (await prisma.accStandardCostItem.create({ data: { item_code: `test.${key("SCI")}`, item_label: key("SCI"), item_name: "TKL", account_id: f.stdAcc, created_by: actor } })).id;
  f.expense = await makeAccount({ subcategoryLabel: "5.1.1", requireCostCenter: true });
  f.cash = await makeAccount({ subcategoryLabel: "1.1.1" });
  f.costType = (await prisma.accCostType.create({ data: { cost_type_code: `test.${key("CT")}`, cost_type_label: key("CT"), cost_type_name: "Upah", expense_account_id: f.expense, standard_cost_item_id: f.stdItem, created_by: actor } })).id;
});

after(async () => {
  const lots = (await prisma.logStockTracking.findMany({ where: { item_id: { in: items } }, select: { id: true } })).map((l) => l.id);
  const closes = (await prisma.prdCostClose.findMany({ where: { period_id: periodId }, select: { id: true } })).map((c) => c.id);
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_cost_close", row_id: { in: closes } } });
  await prisma.prdCostClose.deleteMany({ where: { id: { in: closes } } });
  await prisma.accFiscalPeriod.updateMany({ where: { id: periodId }, data: { production_costed_at: null } });
  await prisma.prdExecutionCost.deleteMany({ where: { execution_id: { in: runs } } });
  await prisma.prdExecutionOutput.deleteMany({ where: { section: { execution_id: { in: runs } } } });
  await prisma.prdExecutionInput.deleteMany({ where: { section: { execution_id: { in: runs } } } });
  await prisma.prdExecutionSection.deleteMany({ where: { execution_id: { in: runs } } });
  await prisma.prdExecution.deleteMany({ where: { id: { in: runs } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_execution", row_id: { in: runs } } });
  await prisma.prdLotLink.deleteMany({ where: { OR: [{ from_lot_id: { in: lots } }, { to_lot_id: { in: lots } }] } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  await prisma.accCostType.deleteMany({ where: { id: f.costType } });
  await prisma.accStandardCostItem.deleteMany({ where: { id: f.stdItem } });
  for (const c of cleanups) await c();
  await cleanupFixtures();
  await cleanupStock(items);
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: f.ws } });
  await prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } });
  await prisma.refUom.deleteMany({ where: { id: f.g } });
  await cleanupFiscalYear();
  await disconnect();
});

const source = async () => ({ docTypeId: (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_execution" } })).id, docId: fakeDoc++, no: "TEST" });
const out = (item: number, qty: number): RunOutputLine => ({ item_id: item, qty, lot_no: "", expiry_date: "", status: "Available" });
const spend = (amount: number, date = closeDay) =>
  prisma.$transaction((tx) =>
    postJournal(tx, {
      description: "uji biaya",
      actorId: actor,
      postingDate: new Date(`${date}T00:00:00Z`),
      lines: [
        { accountId: f.expense, costCenterId: f.cc, currencyId: f.currency, rate: 1, debit: amount, credit: 0, description: "biaya" },
        { accountId: f.cash, currencyId: f.currency, rate: 1, debit: 0, credit: amount, description: "kas" },
      ],
    })
  );

describe("closing a period", () => {
  test("a period that has not ended, or has Drafts, is not closable; the dry run writes nothing", async () => {
    const lot = await stockIn(f.raw, f.warehouse, `${key("L")}${fakeDoc}`, 100, 500_000, null, closeDay);
    const { bucketId } = await prisma.$transaction(async (tx) =>
      enterProduction(tx, { lotId: lot, itemId: f.raw, workstationId: f.ws, partaiId: null, jobId: null, baseQty: 100, value: 500_000, date: day, source: await source(), actorId: actor })
    );
    const r = await createRun(
      { execution_date: closeDay, kind: "Transform", workstation_id: f.ws, note: "" },
      [{ driver: 10, inputs: [{ bucket_id: bucketId, qty: 100, is_main: false }], outputs: [out(f.n, 100)] }],
      actor
    );
    assert.ok(r.ok, JSON.stringify(r));
    runs.push(r.id);
    const draft = await previewClose(periodId);
    assert.ok(draft!.blockers.some((b) => /Eksekusi Produksi.*belum diselesaikan/.test(b)), "a Draft execution blocks the close");
    assert.ok((await transitionRun(r.id, "post", actor)).ok);
    await spend(1_000_000);

    const dry = await runClose(periodId, actor, { dryRun: true });
    assert.ok(dry.ok, JSON.stringify(dry));
    assert.equal((await prisma.accFiscalPeriod.findUniqueOrThrow({ where: { id: periodId } })).production_costed_at, null, "a dry run locks nothing");
    assert.equal(await prisma.prdCostClose.count({ where: { period_id: periodId } }), 0);
  });

  test("the preview shows the pool, the execution's share and the WIP it lands in", async () => {
    const v = (await previewClose(periodId))!;
    assert.deepEqual(v.blockers, []);
    const pool = v.pools.find((p) => p.itemId === f.stdItem)!;
    assert.equal(pool.actual, 1_000_000);
    assert.equal(pool.leftover, 1_000_000);
    assert.equal(v.shares.length, 1);
    assert.equal(v.shares[0].amount, 1_000_000);
    assert.deepEqual(v.dests.map((d) => [d.kind, d.amount]), [["Wip", 1_000_000]]);
  });

  test("running it revalues the bucket, posts Dr WIP / Cr the item's account at the Cost Center, and locks the period", async () => {
    const wipBefore = (await prisma.prdBalance.findFirstOrThrow({ where: { item_id: f.n } })).value_balance.toNumber();
    assert.equal(wipBefore, 500_000);
    const r = await runClose(periodId, actor);
    assert.ok(r.ok, JSON.stringify(r));
    const bucket = await prisma.prdBalance.findFirstOrThrow({ where: { item_id: f.n } });
    assert.equal(bucket.value_balance.toNumber(), 1_500_000, "the leftover joined the goods that carry it");
    assert.equal(bucket.qty_balance.toNumber(), 100, "quantity untouched");
    const row = await prisma.prdLedger.findFirstOrThrow({ where: { bucket_id: bucket.id, movement: "Revalued" } });
    assert.equal(row.qty_change.toNumber(), 0);
    assert.equal(row.value_change.toNumber(), 1_000_000);

    const close = await prisma.prdCostClose.findUniqueOrThrow({ where: { period_id: periodId }, include: { pools: true, shares: true, dests: true } });
    assert.equal(close.leftover_total.toNumber(), 1_000_000);
    assert.ok(close.journal_id);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: close.journal_id! } });
    const dr = lines.filter((l) => l.debit_amount.toNumber() > 0);
    const cr = lines.filter((l) => l.kredit_amount.toNumber() > 0);
    assert.deepEqual(dr.map((l) => [l.account_id, l.debit_amount.toNumber()]), [[f.wipAcc, 1_000_000]]);
    assert.deepEqual(cr.map((l) => [l.account_id, l.kredit_amount.toNumber(), l.cost_center_id]), [[f.stdAcc, 1_000_000, f.cc]]);

    const net = await prisma.accJournalLine.aggregate({ where: { cost_center_id: f.cc, account_id: { in: [f.expense, f.stdAcc] } }, _sum: { debit_amount: true, kredit_amount: true } });
    assert.equal(net._sum.debit_amount!.toNumber(), net._sum.kredit_amount!.toNumber(), "the Cost Center ends at 0");
    assert.ok((await prisma.accFiscalPeriod.findUniqueOrThrow({ where: { id: periodId } })).production_costed_at);
  });

  test("it can be run once", async () => {
    const again = await runClose(periodId, actor);
    assert.ok(!again.ok && /sudah ditutup/.test(again.errors._form));
  });
});

describe("a costed period takes no stock, production or cost posting (M32)", () => {
  test("the guard names the period, and other dates are free", async () => {
    assert.match((await costedPeriodRefusal(closeDay)) ?? "", /sudah ditutup biayanya/);
    assert.equal(await costedPeriodRefusal("2001-04-02"), null);
    assert.equal(await costedPeriodRefusal(new Date().toISOString().slice(0, 10)), null);
  });

  test("stock coming in, goods entering production and a Cost Center line dated in it are refused", async () => {
    await assert.rejects(stockIn(f.raw, f.warehouse, `${key("M")}${fakeDoc}`, 1, 10, null, "2001-03-20"), InventoryRefusal);
    const lot = await stockIn(f.raw, f.warehouse, `${key("N")}${fakeDoc}`, 5, 50, null, "2001-04-02");
    await assert.rejects(
      prisma.$transaction(async (tx) =>
        enterProduction(tx, { lotId: lot, itemId: f.raw, workstationId: f.ws, partaiId: null, jobId: null, baseQty: 1, value: 10, date: new Date("2001-03-20T00:00:00Z"), source: await source(), actorId: actor })
      ),
      ProductionRefusal
    );
    await assert.rejects(spend(1_000, "2001-03-20"), CostCenterRefusal);
    await spend(1_000, "2001-04-02");
  });
});

describe("a value-only revaluation of the stock pool", () => {
  test("raises the value and the average, writes the valuation book only, and refuses an empty or negative pool", async () => {
    const src = { docTypeId: (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_cost_close" } })).id, docId: fakeDoc++, no: "TEST" };
    const before = await prisma.logStockValuationBalance.findUniqueOrThrow({ where: { item_id: f.raw } });
    const rows = await prisma.logStockLedger.count({ where: { item_id: f.raw } });
    await prisma.$transaction((tx) => revaluePool(tx, { itemId: f.raw, value: 25, date: new Date("2001-04-15T00:00:00Z"), source: src, actorId: actor }));
    const after = await prisma.logStockValuationBalance.findUniqueOrThrow({ where: { item_id: f.raw } });
    assert.equal(after.value_balance.toNumber(), before.value_balance.toNumber() + 25);
    assert.equal(after.qty_balance.toNumber(), before.qty_balance.toNumber());
    assert.ok(after.avg_unit_cost.gt(before.avg_unit_cost));
    assert.equal(await prisma.logStockLedger.count({ where: { item_id: f.raw } }), rows, "no quantity row");
    const row = await prisma.logStockValuationLedger.findFirstOrThrow({ where: { item_id: f.raw, source_doc_id: src.docId } });
    assert.equal(row.qty_change.toNumber(), 0);
    assert.equal(row.value_change.toNumber(), 25);
    await assert.rejects(prisma.$transaction((tx) => revaluePool(tx, { itemId: f.raw, value: -1_000_000, date: new Date("2001-04-15T00:00:00Z"), source: src, actorId: actor })), InventoryRefusal);
    await assert.rejects(prisma.$transaction((tx) => revaluePool(tx, { itemId: f.n, value: 10, date: new Date("2001-04-15T00:00:00Z"), source: src, actorId: actor })), InventoryRefusal);
  });
});
