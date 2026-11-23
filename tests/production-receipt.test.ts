import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { advanceToStandBy, availableBuckets, enterProduction } from "../src/lib/erp/production-ledger";
import { finishGoodsOptions, getProductionReceipt, productionReceiptPreview, receiveFinishGoods, sendFinishGoods, type FinishGoodsInput } from "../src/lib/erp/production-receipt";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, type ProductionFixture } from "./production-helpers";

/**
 * BSTB ke Finish Goods (P303): a line routing A › B, B its last Unit. Goods in
 * B's Stand By go to the fixture's warehouse; Terima moves them out of WIP into
 * stock under the same No. Stok, Dr Persediaan / Cr WIP.
 */

const today = new Date().toISOString().slice(0, 10);
const date = new Date(`${today}T00:00:00Z`);
let f: ProductionFixture;
let s: Awaited<ReturnType<typeof sourceOf>>;
const ids = {} as Record<string, number>;
const receipts: number[] = [];
const SCRAP = "production_scrap_account";
let saved: string | undefined;

/** `qty` of the product at a Unit, in Persiapan (or Stand By when `ready`). */
async function stand(unit: number, qty: number, value: number, ready = true) {
  const lot = await prisma.logStockTracking.create({
    data: { tracking_no: f.key(`F${Math.random().toString(36).slice(2, 6)}`), tracking_date: date, item_id: f.product, source_doc_type_id: s.docTypeId, source_doc_id: s.docId, source_no: s.no, created_by: f.actor },
  });
  await prisma.$transaction(async (t) => {
    const e = await enterProduction(t, { lotId: lot.id, itemId: f.product, unitId: unit, baseQty: qty, value, date, source: s, actorId: f.actor });
    if (ready) await advanceToStandBy(t, { bucketId: e.bucketId, baseQty: qty, date, source: s, actorId: f.actor });
  });
  return (await availableBuckets({ unitIds: [unit], stage: ready ? "StandBy" : "Preparation" })).find((b) => b.lotId === lot.id)!;
}

async function send(over: Partial<FinishGoodsInput>) {
  const r = await sendFinishGoods({ from_unit_id: ids.b, warehouse_id: f.warehouse, receipt_date: today, note: "", lines: [], ...over }, f.actor);
  if (r.ok) receipts.push(r.id);
  return r;
}

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("BFG");
  s = await sourceOf("log_stock_issue", "SI/TEST/BFG");
  ids.line = (await prisma.prdLine.create({ data: { line_code: `test.${f.key("LN")}`, line_label: f.key("LN"), line_name: "Uji", created_by: f.actor } })).id;
  ids.routing = (
    await prisma.prdRouting.create({
      data: { routing_code: `test.${f.key("RT")}`, routing_label: f.key("RT"), routing_name: "A B", line_id: ids.line, created_by: f.actor, steps: { create: [{ seq: 1, unit_id: f.wsA }, { seq: 2, unit_id: f.wsB }] } },
    })
  ).id;
  ids.b = f.wsB;
  saved = (await prisma.sysSetting.findUnique({ where: { setting_key: SCRAP } }))?.setting_value ?? undefined;
  await prisma.sysSetting.upsert({ where: { setting_key: SCRAP }, update: { setting_value: String(f.scrapAcc) }, create: { setting_key: SCRAP, setting_value: String(f.scrapAcc), updated_by: f.actor } });
});

after(async () => {
  const journals = (await prisma.logProductionReceipt.findMany({ where: { id: { in: receipts } }, select: { journal_id: true } })).flatMap((r) => (r.journal_id ? [r.journal_id] : []));
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_production_receipt", row_id: { in: receipts } } });
  await prisma.logProductionReceiptLine.deleteMany({ where: { receipt_id: { in: receipts } } });
  await prisma.logProductionReceipt.deleteMany({ where: { id: { in: receipts } } });
  await prisma.accJournalLine.deleteMany({ where: { journal_id: { in: journals } } });
  await prisma.accJournal.deleteMany({ where: { id: { in: journals } } });
  await prisma.prdRouting.deleteMany({ where: { id: ids.routing } });
  await prisma.prdLine.deleteMany({ where: { id: ids.line } });
  if (saved === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: SCRAP } });
  else await prisma.sysSetting.update({ where: { setting_key: SCRAP }, data: { setting_value: saved } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("BSTB ke Finish Goods (P303)", () => {
  test("only the Unit that ends a line sends to Finish Goods", async () => {
    const a = await stand(f.wsA, 2, 2000);
    const r = await send({ from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: a.qty }] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.from_unit_id, /bukan Unit terakhir/);
    assert.equal((await finishGoodsOptions(f.wsA))?.endsLine, false);
    assert.equal((await finishGoodsOptions(f.wsB))?.endsLine, true);
  });

  test("Kirim keeps the goods at the Unit as Dalam Perjalanan; Terima brings them into stock, Dr Persediaan / Cr WIP", async () => {
    const b = await stand(f.wsB, 5, 5000);
    const sent = await send({ lines: [{ bucket_id: b.id, qty: b.qty }] });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    if (!sent.ok) return;
    assert.match(sent.no, /^BFG_/);
    assert.equal((await availableBuckets({ unitIds: [f.wsB], stage: "StandBy" })).some((x) => x.lotId === b.lotId), false);
    const transit = (await availableBuckets({ unitIds: [f.wsB], stage: "InTransit" })).find((x) => x.lotId === b.lotId);
    assert.equal(transit?.qty, 5);

    // The preview is the posting itself, rolled back (P103).
    const preview = await productionReceiptPreview(sent.id, f.actor);
    assert.equal(preview.ok, true, JSON.stringify(preview));
    if (preview.ok) {
      assert.deepEqual(
        preview.lines.map((l) => [l.debit, l.credit]),
        [
          [5000, 0],
          [0, 5000],
        ]
      );
    }
    assert.equal((await getProductionReceipt(sent.id))?.status, "Submitted");

    const got = await receiveFinishGoods(sent.id, f.actor);
    assert.equal(got.ok, true, JSON.stringify(got));
    const view = await getProductionReceipt(sent.id);
    assert.equal(view?.status, "Posted");
    assert.equal(view?.cost, 5000);
    assert.equal(view?.items[0].value, 5000);
    assert.equal(view?.items[0].lotNo, b.lotNo);
    assert.equal((await availableBuckets({ unitIds: [f.wsB], stage: "InTransit" })).some((x) => x.lotId === b.lotId), false);
    const stock = await prisma.logStockBalance.findFirst({ where: { warehouse_id: f.warehouse, tracking_id: b.lotId } });
    assert.equal(stock?.qty_balance.toNumber(), 5);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: view!.journalId! }, orderBy: { id: "asc" } });
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.inventoryAcc, 5000, 0],
        [f.wipAcc, 0, 5000],
      ]
    );

    const again = await receiveFinishGoods(sent.id, f.actor);
    assert.equal(again.ok, false);
  });

  test("a bucket no longer in Stand By is refused", async () => {
    const b = await stand(f.wsB, 1, 100);
    assert.equal((await send({ lines: [{ bucket_id: b.id, qty: b.qty }] })).ok, true);
    const r = await send({ lines: [{ bucket_id: b.id, qty: b.qty }] });
    assert.equal(r.ok, false);
  });
});

describe("BSTB Pengeluaran (P304)", () => {
  test("any Unit sends from Persiapan in part; Tanpa nilai brings the goods in at 0 and charges Beban Pemusnahan", async () => {
    const a = await stand(f.wsA, 10, 1000, false);
    const sent = await send({ purpose: "return", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 4 }] });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    if (!sent.ok) return;
    assert.match(sent.no, /^BPG_/);
    assert.equal((await availableBuckets({ unitIds: [f.wsA], stage: "Preparation" })).find((x) => x.lotId === a.lotId)?.qty, 6);

    const unchosen = await receiveFinishGoods(sent.id, f.actor);
    assert.equal(unchosen.ok, false);

    const got = await receiveFinishGoods(sent.id, f.actor, { valueMode: "none" });
    assert.equal(got.ok, true, JSON.stringify(got));
    const view = await getProductionReceipt(sent.id);
    assert.equal(view?.cost, 400);
    assert.equal(view?.writtenOff, 400);
    assert.equal(view?.valueMode, "none");
    const stock = await prisma.logStockBalance.findFirst({ where: { warehouse_id: f.warehouse, tracking_id: a.lotId } });
    assert.equal(stock?.qty_balance.toNumber(), 4);
    const valued = await prisma.logStockValuationLedger.findMany({ where: { source_doc_id: sent.id, item_id: f.product } });
    assert.equal(valued.reduce((x, v) => x + v.value_change.toNumber(), 0), 0);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: view!.journalId! }, orderBy: { id: "asc" } });
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.scrapAcc, 400, 0],
        [f.wipAcc, 0, 400],
      ]
    );
  });

  test("Nilai terbawa brings them in at their value, Dr Persediaan / Cr WIP", async () => {
    const a = await stand(f.wsA, 3, 900);
    const sent = await send({ purpose: "return", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 3 }] });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    if (!sent.ok) return;
    const preview = await productionReceiptPreview(sent.id, f.actor, "carried");
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal((await receiveFinishGoods(sent.id, f.actor, { valueMode: "carried" })).ok, true);
    const view = await getProductionReceipt(sent.id);
    assert.equal(view?.writtenOff, 0);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: view!.journalId! }, orderBy: { id: "asc" } });
    assert.deepEqual(
      lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.inventoryAcc, 900, 0],
        [f.wipAcc, 0, 900],
      ]
    );
  });

  test("more than the balance is refused", async () => {
    const a = await stand(f.wsA, 2, 200, false);
    const r = await send({ purpose: "return", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 3 }] });
    assert.equal(r.ok, false);
  });
});
