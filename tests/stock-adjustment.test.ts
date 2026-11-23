import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { countSheet, createStockAdjustment, getStockAdjustment, stockAdjustmentPreview, transitionStockAdjustment, updateStockAdjustment, type StockAdjustmentLineInput } from "../src/lib/erp/stock-adjustment";
import { cleanupFiscalYear, cleanupFixtures, disconnect, makeAccount, openFiscalYear, prisma, stockIn } from "./helpers";
import { makeProductionFixture, type ProductionFixture } from "./production-helpers";

/**
 * The Stock Adjustment (P318): a count of one warehouse. 1.000 of the material at
 * Rp 1.000.000 to start with. A bucket that moved refuses its line; a shortage
 * leaves at the average, an excess comes in at it, or at the value typed when the
 * company holds none; Persediaan against Selisih Persediaan.
 */

const today = new Date().toISOString().slice(0, 10);
const KEY = "stock_difference_account";
let f: ProductionFixture;
let diffAcc: number;
let status: number;
let saved: string | undefined;
const ids: number[] = [];

const row = (over: Partial<StockAdjustmentLineInput>): StockAdjustmentLineInput => ({ item_id: f.material, tracking_no: f.key("L1"), location_id: null, stock_status_id: status, book_qty: 1_000, counted_qty: "", value: "", note: "", ...over });
async function make(lines: StockAdjustmentLineInput[]) {
  const r = await createStockAdjustment({ adjustment_date: today, warehouse_id: f.warehouse, note: "" }, lines, f.actor);
  if (r.ok) ids.push(r.id);
  return r;
}
async function post(lines: StockAdjustmentLineInput[]) {
  const r = await make(lines);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok((await transitionStockAdjustment(r.id, "submit", f.actor)).ok);
  const done = await transitionStockAdjustment(r.id, "approve", f.actor);
  assert.ok(done.ok, JSON.stringify(done));
  return (await getStockAdjustment(r.id))!;
}
const pool = async (item: number) => {
  const p = await prisma.logStockValuationBalance.findFirst({ where: { item_id: item } });
  return [p?.qty_balance.toNumber() ?? 0, p?.value_balance.toNumber() ?? 0];
};

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("SA");
  status = (await prisma.sysStockStatus.findUniqueOrThrow({ where: { status_label: "TERSEDIA" } })).id;
  diffAcc = await makeAccount({ subcategoryLabel: "5.1.9" });
  saved = (await prisma.sysSetting.findUnique({ where: { setting_key: KEY } }))?.setting_value ?? undefined;
  await prisma.sysSetting.upsert({ where: { setting_key: KEY }, update: { setting_value: String(diffAcc) }, create: { setting_key: KEY, setting_value: String(diffAcc), updated_by: f.actor } });
});

after(async () => {
  await prisma.logStockAdjustmentLine.deleteMany({ where: { stock_adjustment_id: { in: ids } } });
  await prisma.logStockAdjustment.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_stock_adjustment", row_id: { in: ids } } });
  if (saved === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: KEY } });
  else await prisma.sysSetting.update({ where: { setting_key: KEY }, data: { setting_value: saved } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("a count", () => {
  test("the sheet is what the books hold, and a Draft may be counted in part; Ajukan needs it whole", async () => {
    const sheet = await countSheet(f.warehouse);
    assert.deepEqual(sheet.rows.map((r) => [r.tracking_no, r.book_qty]), [[f.key("L1"), 1_000]]);
    const r = await make([row({})]);
    assert.ok(r.ok, JSON.stringify(r));
    const s = await transitionStockAdjustment(r.id, "submit", f.actor);
    assert.ok(!s.ok && /Belum dihitung/.test(s.errors._form));
    assert.ok((await transitionStockAdjustment(r.id, "cancel", f.actor, "uji")).ok);
  });

  test("a lot of another item, the same bucket twice and a negative count are refused", async () => {
    const other = await make([row({ item_id: f.product, counted_qty: 1 })]);
    assert.ok(!other.ok && /bukan lot/.test(other.errors["lines.0.tracking_no"]));
    const twice = await make([row({ counted_qty: 1 }), row({ counted_qty: 2 })]);
    assert.ok(!twice.ok && /baris lain/.test(twice.errors["lines.1.tracking_no"]));
    const minus = await make([row({ counted_qty: -1 })]);
    assert.ok(!minus.ok && /minimal 0/.test(minus.errors["lines.0.counted_qty"]));
  });

  test("a bucket that moved since it was counted refuses, at the approval too, and nothing is posted", async () => {
    const r = await make([row({ counted_qty: 990 })]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await transitionStockAdjustment(r.id, "submit", f.actor)).ok);
    await stockIn(f.material, f.warehouse, f.key("L1"), 100, 100_000);
    const a = await transitionStockAdjustment(r.id, "approve", f.actor);
    assert.ok(!a.ok && /berubah dari 1.000 menjadi 1.100/.test(a.errors._form), JSON.stringify(a));
    assert.equal((await getStockAdjustment(r.id))!.status, "Submitted");
    assert.deepEqual(await pool(f.material), [1_100, 1_100_000]);
    assert.ok((await transitionStockAdjustment(r.id, "reject", f.actor, "hitung ulang")).ok);
  });
});

describe("the approval posts the difference", () => {
  test("a shortage leaves at the average: Dr Selisih Persediaan / Cr Persediaan, the preview the same", async () => {
    const r = await make([row({ book_qty: 1_100, counted_qty: 1_080 })]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await transitionStockAdjustment(r.id, "submit", f.actor)).ok);
    const preview = await stockAdjustmentPreview(r.id, f.actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    if (preview.ok) assert.deepEqual(preview.lines.map((l) => [l.debit, l.credit]), [[20_000, 0], [0, 20_000]]);
    assert.deepEqual(await pool(f.material), [1_100, 1_100_000], "a dry run moves nothing");
    assert.ok((await transitionStockAdjustment(r.id, "approve", f.actor)).ok);
    const v = (await getStockAdjustment(r.id))!;
    assert.deepEqual([v.status, v.short, v.over, v.lines[0].valueAmount], ["Posted", 20_000, 0, -20_000]);
    const j = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(j.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]), [[diffAcc, 20_000, 0], [f.inventoryAcc, 0, 20_000]]);
    assert.deepEqual(await pool(f.material), [1_080, 1_080_000]);
    assert.ok(!(await updateStockAdjustment(r.id, v.header, v.lines, f.actor)).ok, "final");
  });

  test("shortages go before excesses, whatever the order of the lines, and the average stands", async () => {
    await stockIn(f.material, f.warehouse, f.key("L2"), 20, 240_000); // average 1.200
    const v = await post([row({ tracking_no: f.key("L2"), book_qty: 20, counted_qty: 30 }), row({ book_qty: 1_080, counted_qty: 1_000 })]);
    assert.deepEqual([v.over, v.short], [12_000, 96_000]);
    assert.deepEqual(await pool(f.material), [1_030, 1_236_000]);
  });

  test("with none left in the company the excess takes the value typed, and asks for it when missing", async () => {
    const zero = await post([row({ book_qty: 1_000, counted_qty: 0 }), row({ tracking_no: f.key("L2"), book_qty: 30, counted_qty: 0 })]);
    assert.equal(zero.short, 1_236_000);
    assert.deepEqual(await pool(f.material), [0, 0]);
    const r = await make([row({ book_qty: 0, counted_qty: 5 })]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await transitionStockAdjustment(r.id, "submit", f.actor)).ok);
    const a = await transitionStockAdjustment(r.id, "approve", f.actor);
    assert.ok(!a.ok && /isi nilai lebihnya/.test(a.errors._form), JSON.stringify(a));
    assert.ok((await transitionStockAdjustment(r.id, "reject", f.actor, "isi nilai")).ok);
    const v = await post([row({ book_qty: 0, counted_qty: 5, value: 6_000 })]);
    assert.equal(v.over, 6_000);
    assert.deepEqual(await pool(f.material), [5, 6_000]);
  });

  test("a count that found nothing posts nothing", async () => {
    const v = await post([row({ book_qty: 5, counted_qty: 5 })]);
    assert.deepEqual([v.status, v.journalId, v.short, v.over], ["Posted", null, 0, 0]);
  });
});
