import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { advanceToStandBy, availableBuckets, enterProduction } from "../src/lib/erp/production-ledger";
import { getProductionIssue, productionIssueOptions, sendProductionIssue, type ProductionIssueInput } from "../src/lib/erp/production-issue";
import { getStockReceipt, receiveStockReceipt, stockReceiptPreview } from "../src/lib/erp/stock-receipt";
import { deliver } from "../src/lib/erp/handover";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, sourceOf, stockReceiptOf, type ProductionFixture } from "./production-helpers";

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
const SCRAP = "production_scrap_account";
let saved: string | undefined;
/** Warehouses made by a test, removed after the fixture's stock. */
const extra: number[] = [];

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

async function send(over: Partial<ProductionIssueInput>, make = true) {
  const r = await sendProductionIssue({ from_unit_id: ids.b, warehouse_id: f.warehouse, issue_date: today, note: "", lines: [], ...over }, f.actor);
  // The warehouse makes the Stock Receipt from what was sent (P339); the Production Issue is `issueId`.
  return r.ok ? { ...r, issueId: r.id, id: make ? await stockReceiptOf(r.no, f.actor) : 0 } : r;
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
  await prisma.prdRouting.deleteMany({ where: { id: ids.routing } });
  await prisma.prdLine.deleteMany({ where: { id: ids.line } });
  if (saved === undefined) await prisma.sysSetting.deleteMany({ where: { setting_key: SCRAP } });
  else await prisma.sysSetting.update({ where: { setting_key: SCRAP }, data: { setting_value: saved } });
  await f.teardown();
  await prisma.refWarehouseLocation.deleteMany({ where: { warehouse_id: { in: extra } } });
  await prisma.refWarehouse.deleteMany({ where: { id: { in: extra } } });
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
    assert.equal((await productionIssueOptions(f.wsA))?.endsLine, false);
    assert.equal((await productionIssueOptions(f.wsB))?.endsLine, true);
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
    const preview = await stockReceiptPreview(sent.id, f.actor);
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
    assert.equal((await getStockReceipt(sent.id))?.status, "Draft");

    const got = await receiveStockReceipt(sent.id, f.actor);
    assert.equal(got.ok, true, JSON.stringify(got));
    const view = await getStockReceipt(sent.id);
    assert.equal(view?.status, "Received");
    assert.equal(view?.cost, 5000);
    assert.equal(view?.rows[0].value, 5000);
    assert.equal(view?.rows[0].trackingNo, b.lotNo);
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

    const again = await receiveStockReceipt(sent.id, f.actor);
    assert.equal(again.ok, false);
    const issue = await getProductionIssue(sent.issueId);
    assert.deepEqual([issue?.status, issue?.receivedAt], ["Received", today], "both sides say Diterima");
    const rows = await prisma.prdLedger.count({ where: { tracking_id: b.lotId } });
    await prisma.$transaction((tx) => deliver(tx, { type: "ReceiptReceived", no: sent.no, date: today }, f.actor));
    assert.equal(await prisma.prdLedger.count({ where: { tracking_id: b.lotId } }), rows, "said twice, nothing moves");
  });

  test("a bucket no longer in Stand By is refused", async () => {
    const b = await stand(f.wsB, 1, 100);
    assert.equal((await send({ lines: [{ bucket_id: b.id, qty: b.qty }] })).ok, true);
    const r = await send({ lines: [{ bucket_id: b.id, qty: b.qty }] });
    assert.equal(r.ok, false);
  });
});

describe("BSTB Pengeluaran (P304)", () => {
  test("any Unit sends from Persiapan in part; Tanpa nilai, chosen by the Unit, brings the goods in at 0 and charges Beban Pemusnahan", async () => {
    const a = await stand(f.wsA, 10, 1000, false);
    const unchosen = await send({ purpose: "return", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 4 }] });
    assert.equal(unchosen.ok, false, "the Unit says whether the goods keep value (P339)");
    const sent = await send({ purpose: "return", value_mode: "none", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 4 }] });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    if (!sent.ok) return;
    assert.match(sent.no, /^BPG_/);
    assert.equal((await availableBuckets({ unitIds: [f.wsA], stage: "Preparation" })).find((x) => x.lotId === a.lotId)?.qty, 6);

    const got = await receiveStockReceipt(sent.id, f.actor);
    assert.equal(got.ok, true, JSON.stringify(got));
    const view = await getStockReceipt(sent.id);
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
    const sent = await send({ purpose: "return", value_mode: "carried", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 3 }] });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    if (!sent.ok) return;
    const preview = await stockReceiptPreview(sent.id, f.actor);
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal((await receiveStockReceipt(sent.id, f.actor)).ok, true);
    const view = await getStockReceipt(sent.id);
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

  test("two documents of one No. Stok keep their own frozen value, whichever is taken in first", async () => {
    const a = await stand(f.wsA, 3, 100, false);
    const first = await send({ purpose: "return", value_mode: "carried", reason: "reject", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 1 }] });
    assert.ok(first.ok, JSON.stringify(first));
    const second = await send({ purpose: "return", value_mode: "carried", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 2 }] });
    assert.ok(second.ok, JSON.stringify(second));
    assert.ok((await receiveStockReceipt(second.id, f.actor)).ok);
    assert.ok((await receiveStockReceipt(first.id, f.actor)).ok);
    assert.deepEqual([(await getStockReceipt(first.id))!.cost, (await getStockReceipt(second.id))!.cost], [33, 67]);
    assert.equal((await getProductionIssue(first.issueId))!.reason, "reject");
  });

  test("a warehouse with locations: each No. Stok needs one, and may come in under another status", async () => {
    const wh = await prisma.refWarehouse.create({ data: { warehouse_code: `test.${f.key("WL")}`, warehouse_label: f.key("WL"), warehouse_name: "Berlokasi", created_by: f.actor } });
    const loc = await prisma.refWarehouseLocation.create({ data: { location_code: `test.${f.key("LC")}`, location_label: "A-01", location_name: "Rak A", warehouse_id: wh.id, created_by: f.actor } });
    const a = await stand(f.wsA, 2, 500, false);
    const sent = await send({ purpose: "return", value_mode: "carried", from_unit_id: f.wsA, warehouse_id: wh.id, lines: [{ bucket_id: a.id, qty: 2 }] }, false);
    assert.ok(sent.ok, JSON.stringify(sent));
    if (!sent.ok) return;
    await assert.rejects(stockReceiptOf(sent.no, f.actor), /lokasi/i, "no location chosen");
    const held = await prisma.sysStockStatus.findFirstOrThrow({ where: { status_label: { not: "TERSEDIA" } } });
    const id = await stockReceiptOf(sent.no, f.actor, { location_id: loc.id, stock_status_id: held.id });
    const got = await receiveStockReceipt(id, f.actor);
    assert.ok(got.ok, JSON.stringify(got));
    const stock = await prisma.logStockBalance.findFirstOrThrow({ where: { warehouse_id: wh.id } });
    assert.deepEqual([stock.location_id, stock.stock_status_id, stock.qty_balance.toNumber()], [loc.id, held.id, 2]);
    extra.push(wh.id);
  });

  test("more than the balance is refused", async () => {
    const a = await stand(f.wsA, 2, 200, false);
    const r = await send({ purpose: "return", from_unit_id: f.wsA, lines: [{ bucket_id: a.id, qty: 3 }] });
    assert.equal(r.ok, false);
  });
});
