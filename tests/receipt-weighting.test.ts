import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { checkItemWeighting, writeItemWeighting, itemCollections } from "../src/lib/erp/item";
import { weightingErrors } from "../src/lib/erp/item-shape";
import { createReceiptNote, getReceiptNote, receiptNoteOptions, transitionReceiptNote, updateReceiptNote, type ReceiptNoteHeaderInput, type ReceiptNoteLineInput } from "../src/lib/erp/receipt-note";
import { weigh } from "../src/lib/erp/receipt-weighting";
import { bonusReceiptOf, getStockReceipt } from "../src/lib/erp/stock-receipt";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { purchasingWorld, type PurchasingWorld } from "./purchasing-helpers";

/**
 * Weighing at the Receipt Note (P321): the supplier's quantity compared with the
 * scale by the item's weight and tolerance; within or above it the SJ is taken,
 * below it what the scale says; what weighs beyond the upper edge comes in as a
 * Stock Receipt at 0.
 */

const today = new Date().toISOString().slice(0, 10);
let w: PurchasingWorld;
const rns: number[] = [];

const header = (po: number): ReceiptNoteHeaderInput => ({ source_doc_id: po, rn_date: today, warehouse_id: w.f.warehouse, supplier_dn_no: "SJ-1", note: "" });
const line = (id: number, qty: number, scale: number | string | null, lots: number[] = [], tag = "L"): ReceiptNoteLineInput => ({
  source_doc_line_id: id,
  qty,
  qty_weighting: scale,
  note: "",
  lots: lots.map((q, i) => ({ tracking_no: w.key(`${tag}${i}`), expiry_date: "", qty: q })),
});
async function create(po: number, lines: ReceiptNoteLineInput[]) {
  const r = await createReceiptNote(header(po), lines, w.actor);
  if (r.ok) rns.push(r.id);
  return r;
}
const setRule = (item_weight: number, receiving_tolerance: number) =>
  prisma.mItemWeighting.upsert({ where: { item_id: w.f.stock }, update: { item_weight, receiving_tolerance }, create: { item_id: w.f.stock, item_weight, receiving_tolerance, created_by: w.actor } });

before(async () => {
  await openFiscalYear();
  w = await purchasingWorld("WGH");
});

after(async () => {
  const receipts = await prisma.logStockReceipt.findMany({ where: { purpose: "purchase_bonus", source_doc_id: { in: rns } }, select: { id: true } });
  const ids = receipts.map((r) => r.id);
  await prisma.logStockReceiptTracking.deleteMany({ where: { line: { stock_receipt_id: { in: ids } } } });
  await prisma.logStockReceiptLine.deleteMany({ where: { stock_receipt_id: { in: ids } } });
  await prisma.logStockReceipt.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entity_key: "log_stock_receipt", row_id: { in: ids } }, { entity_key: "log_receipt_note", row_id: { in: rns } }] } });
  await prisma.logReceiptNoteTracking.deleteMany({ where: { line: { receipt_note_id: { in: rns } } } });
  await prisma.logReceiptNoteLine.deleteMany({ where: { receipt_note_id: { in: rns } } });
  await prisma.logReceiptNote.deleteMany({ where: { id: { in: rns } } });
  await prisma.mItemWeighting.deleteMany({ where: { item_id: w.f.stock } });
  await w.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("the arithmetic", () => {
  const at = (sj: number, scale: number, over: Partial<Parameters<typeof weigh>[0]> = {}) => weigh({ sj, sjBase: sj, factor: 1, scale, rule: { itemWeight: 1, tolerance: 10 }, ...over });

  test("the three cases of the agreed screens", () => {
    const within = at(200, 200);
    assert.deepEqual([within.lower, within.upper, within.result, within.received, within.bonus], [180, 220, "Within", 200, 0]);
    const above = at(800, 1_000);
    assert.deepEqual([above.lower, above.upper, above.result, above.received, above.bonus], [720, 880, "Above", 800, 120]);
    const below = at(800, 500);
    assert.deepEqual([below.result, below.received, below.bonus], ["Below", 500, 0]);
  });

  test("both edges are within", () => {
    assert.deepEqual([719, 720, 880, 881].map((s) => [at(800, s).result, at(800, s).received, at(800, s).bonus]), [
      ["Below", 719, 0],
      ["Within", 800, 0],
      ["Within", 800, 0],
      ["Above", 800, 1],
    ]);
  });

  test("another unit: the scale's pieces back to boxes, rounded down at four decimals", () => {
    const rule = { itemWeight: 0.5, tolerance: 1 };
    // 4,777 boxes of 12 at 0,5 Kg a piece weigh 28,662 Kg.
    const box = weigh({ sj: 5, sjBase: 60, factor: 12, scale: 28.662, rule });
    assert.deepEqual([box.result, box.receivedBase, box.received], ["Below", 57.324, 4.777]);
    const half = weigh({ sj: 100, sjBase: 1_200, factor: 12, scale: 250, rule });
    assert.deepEqual([half.receivedBase, half.received], [500, 41.666667]);
    assert.equal(weigh({ sj: 10, sjBase: 10, factor: 1, scale: 1, rule: { itemWeight: 0.3, tolerance: 0 } }).receivedBase, 3.3333);
  });

  test("the Timbangan of an item: weight over 0, tolerance under 100, a stocked Barang only", () => {
    assert.deepEqual(weightingErrors({ itemWeight: "0.5", tolerance: "10" }), {});
    assert.ok(weightingErrors({ itemWeight: "0" }).itemWeight);
    assert.ok(weightingErrors({ itemWeight: "1", tolerance: "100" }).tolerance);
    const row = JSON.stringify([{ key: "w", itemWeight: "1", tolerance: "" }]);
    assert.deepEqual(checkItemWeighting({ _weighting: row, item_type: "Barang", track_stock: true }), { errors: {}, clean: { item_weight: "1", receiving_tolerance: "0" } });
    assert.match(checkItemWeighting({ _weighting: row, item_type: "Jasa" }).errors._weighting, /Kelola Stok/);
    assert.equal(checkItemWeighting({ _weighting: "[]" }).clean, null);
  });

  test("saved with the Item and taken off again", async () => {
    await prisma.$transaction((tx) => writeItemWeighting(tx, w.f.stock, { item_weight: "0.25", receiving_tolerance: "5" }, w.actor));
    assert.deepEqual((await itemCollections(w.f.stock)).weighting.map((x) => [x.itemWeight, x.tolerance]), [["0.25", "5"]]);
    await prisma.$transaction((tx) => writeItemWeighting(tx, w.f.stock, null, w.actor));
    assert.deepEqual((await itemCollections(w.f.stock)).weighting, []);
  });
});

describe("receiving by weight", () => {
  test("a weighed item posts only once weighed; below tolerance receives the scale, the rest stays on the PO", async () => {
    await setRule(1, 10);
    const po = await w.openPO([{ item: w.f.stock, qty: 800, price: 1_000 }]);
    const r = await create(po.id, [line(po.lineIds[0], 800, "")]);
    assert.ok(r.ok, JSON.stringify(r));
    const unweighed = await transitionReceiptNote(r.id, "post", w.actor);
    assert.ok(!unweighed.ok && /belum ditimbang/.test(unweighed.errors._form), JSON.stringify(unweighed));

    const lots = await updateReceiptNote(r.id, header(po.id), [line(po.lineIds[0], 800, 500, [800])], w.actor);
    assert.ok(!lots.ok && /melebihi yang diterima \(500/.test(lots.errors["lines.0.lots"]), JSON.stringify(lots));
    assert.ok((await updateReceiptNote(r.id, header(po.id), [line(po.lineIds[0], 800, 500, [300, 200], "B")], w.actor)).ok);
    assert.deepEqual(await transitionReceiptNote(r.id, "post", w.actor), { ok: true, closed: [] });
    const v = (await getReceiptNote(r.id))!;
    assert.deepEqual([v.lines[0].qty, v.lines[0].received, v.lines[0].baseQty, v.value], [800, 500, 500, 500_000]);
    assert.equal(v.lines[0].weighing!.result, "Below");
    assert.equal(await bonusReceiptOf(r.id), null);
    const left = (await receiptNoteOptions()).orders.find((o) => o.id === po.id)!.lines[0];
    assert.equal(left.qty - left.held, 300);
  });

  test("above tolerance takes the SJ and brings the rest in as a Stock Receipt at 0", async () => {
    await setRule(1, 10);
    const po = await w.openPO([{ item: w.f.stock, qty: 800, price: 1_000 }]);
    const pool = async () => prisma.logStockValuationBalance.findFirstOrThrow({ where: { item_id: w.f.stock } });
    const before = await pool();
    const r = await create(po.id, [line(po.lineIds[0], 800, 1_000, [800], "AB")]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(await bonusReceiptOf(r.id), null, "a Draft makes nothing");
    assert.deepEqual(await transitionReceiptNote(r.id, "post", w.actor), { ok: true, closed: [po.orderNo] });
    const b = (await bonusReceiptOf(r.id))!;
    assert.match(b.no, /^SRC\/\d{4}\/\d{2}\/\d{4}$/);
    const s = (await getStockReceipt(b.id))!;
    assert.deepEqual([s.purpose, s.status, s.cost, s.journalId, s.sourceNo, s.items.map((i) => [i.qty, i.value])], ["purchase_bonus", "Received", 0, null, r.rnNo, [[120, 0]]]);
    const now = await pool();
    assert.equal(now.qty_balance.minus(before.qty_balance).toNumber(), 920);
    assert.equal(now.value_balance.minus(before.value_balance).toNumber(), 800_000, "a bonus brings no value");
    assert.equal((await getReceiptNote(r.id))!.value, 800_000, "the supplier is owed the SJ only");
  });

  test("a saved weighing keeps the Timbangan it was made with, whatever the item says when it posts", async () => {
    await setRule(1, 10);
    const po = await w.openPO([{ item: w.f.stock, qty: 100, price: 1_000 }]);
    const r = await create(po.id, [line(po.lineIds[0], 100, 95, [100], "SN")]);
    assert.ok(r.ok, JSON.stringify(r));
    await setRule(1, 1);
    assert.deepEqual(await transitionReceiptNote(r.id, "post", w.actor), { ok: true, closed: [po.orderNo] });
    const v = (await getReceiptNote(r.id))!;
    assert.deepEqual([v.lines[0].received, v.lines[0].weighing!.rule.tolerance], [100, 10]);
    // A form cannot bring its own rule.
    const po2 = await w.openPO([{ item: w.f.stock, qty: 100, price: 1_000 }]);
    const forged = await create(po2.id, [{ ...line(po2.lineIds[0], 100, 95), weighing_rule: { itemWeight: 1, tolerance: 50 } }]);
    assert.ok(forged.ok);
    assert.equal((await getReceiptNote(forged.id))!.lines[0].received, 95);
  });

  test("boxes by weight: 41,666667 then the rest, adding up to the order", async () => {
    await setRule(0.5, 1);
    const po = await w.openPO([{ item: w.f.stock, qty: 100, price: 1_000_000, uom: w.f.box }]);
    const a = await create(po.id, [line(po.lineIds[0], 100, 250, [10, 31.666667], "X")]);
    assert.ok(a.ok, JSON.stringify(a));
    assert.deepEqual(await transitionReceiptNote(a.id, "post", w.actor), { ok: true, closed: [] });
    assert.equal((await getReceiptNote(a.id))!.value, 41_666_667);
    const split = await prisma.logReceiptNoteTracking.findMany({ where: { line: { receipt_note_id: a.id } }, orderBy: { tracking_seq: "asc" } });
    assert.deepEqual(split.map((t) => [t.qty.toNumber(), t.base_qty.toNumber(), t.base_cost_amount.toNumber()]), [[10, 120, 10_000_000], [31.666667, 380, 31_666_667]]);
    const left = (await receiptNoteOptions()).orders.find((o) => o.id === po.id)!.lines[0];
    const rest = +(left.qty - left.held).toFixed(6);
    assert.equal(rest, 58.333333);
    const b = await create(po.id, [line(po.lineIds[0], rest, 350, [rest], "Y")]);
    assert.ok(b.ok, JSON.stringify(b));
    assert.deepEqual(await transitionReceiptNote(b.id, "post", w.actor), { ok: true, closed: [po.orderNo] });
    assert.equal((await getReceiptNote(b.id))!.value, 58_333_333);
    const l = await prisma.purOrderLine.findUniqueOrThrow({ where: { id: po.lineIds[0] } });
    assert.deepEqual([l.received_qty.toNumber(), l.received_base_qty.toNumber()], [100, 1_200]);
  });
});
