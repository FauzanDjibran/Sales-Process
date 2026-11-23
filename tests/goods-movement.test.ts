import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { createStockIssue, transitionStockIssue } from "../src/lib/erp/stock-issue";
import { receiveStockReceipt } from "../src/lib/erp/stock-receipt";
import { sendProductionIssue } from "../src/lib/erp/production-issue";
import { availableBuckets } from "../src/lib/erp/production-ledger";
import { deliver } from "../src/lib/erp/handover";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma, stockIn } from "./helpers";
import { makeProductionFixture, stockReceiptOf, takeIn, type ProductionFixture } from "./production-helpers";

/**
 * Goods-Movement-Plan §6.2 on the real code: forty random events — purchases that
 * move the average, issues, Terima in any order, returns, messages said twice —
 * and after each one WIP in the General Ledger is what production holds plus what
 * is on its way to it. A fixed seed, so a failure repeats.
 */

const today = new Date().toISOString().slice(0, 10);
let f: ProductionFixture;
const issues: number[] = [];
let seed = 20261124;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: T[]) => xs[ri(0, xs.length - 1)];

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("GM");
  await stockIn(f.material, f.warehouse, f.key("OPEN"), 1, 1); // the injection's inventory is not journalled; only WIP is compared
});

after(async () => {
  await prisma.logStockIssueTracking.deleteMany({ where: { line: { stock_issue_id: { in: issues } } } });
  await prisma.logStockIssueLine.deleteMany({ where: { stock_issue_id: { in: issues } } });
  await prisma.logStockIssue.deleteMany({ where: { id: { in: issues } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_stock_issue", row_id: { in: issues } } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

async function position() {
  const gl = await prisma.accJournalLine.aggregate({ _sum: { debit_amount: true, kredit_amount: true }, where: { account_id: f.wipAcc } });
  const held = await prisma.prdBalance.aggregate({ _sum: { value_balance: true }, where: { item_id: f.material } });
  const coming = await prisma.prdReceiptLine.aggregate({ _sum: { value: true }, where: { item_id: f.material, receipt: { status: "InTransit" } } });
  const n = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
  return { gl: n(gl._sum.debit_amount) - n(gl._sum.kredit_amount), production: n(held._sum.value_balance), coming: n(coming._sum.value) };
}

test("WIP = production + on its way, after every one of forty random events", async () => {
  const done: Record<string, number> = {};
  const count = (k: string) => (done[k] = (done[k] ?? 0) + 1);
  const events: (() => Promise<void>)[] = [
    async () => {
      await stockIn(f.material, f.warehouse, f.key(`B${Date.now() % 1e7}${ri(0, 999)}`), ri(20, 90), ri(10_000, 190_000));
      count("beli");
    },
    async () => {
      const bucket = pick(await prisma.logStockBalance.findMany({ where: { item_id: f.material, warehouse_id: f.warehouse, qty_balance: { gte: 2 } } }));
      if (!bucket) return;
      const qty = ri(1, Math.floor(bucket.qty_balance.toNumber()));
      const r = await createStockIssue({ purpose: "auxiliary_issue", warehouse_id: f.warehouse, unit_id: pick([f.wsA, f.wsB]), issue_date: today, note: "" }, [{ item_id: f.material, qty, note: "", picks: [{ tracking_id: bucket.tracking_id, location_id: null, qty }] }], f.actor);
      assert.ok(r.ok, JSON.stringify(r));
      issues.push(r.id);
      assert.ok((await transitionStockIssue(r.id, "submit", f.actor)).ok);
      count("kirim");
    },
    async () => {
      const waiting = pick(await prisma.prdReceipt.findMany({ where: { status: "InTransit", lines: { some: { item_id: f.material } } } }));
      if (!waiting) return;
      assert.ok((await takeIn(waiting.receipt_no, f.actor)).ok);
      count("terima unit");
    },
    async () => {
      const b = pick((await availableBuckets({ unitIds: [f.wsA, f.wsB], stage: "Preparation" })).filter((x) => x.itemId === f.material && x.qty >= 2));
      if (!b) return;
      const r = await sendProductionIssue({ purpose: "return", from_unit_id: b.unitId, warehouse_id: f.warehouse, issue_date: today, note: "", lines: [{ bucket_id: b.id, qty: ri(1, Math.floor(b.qty)) }] }, f.actor);
      assert.ok(r.ok, JSON.stringify(r));
      count("keluar unit");
    },
    async () => {
      const waiting = pick(await prisma.prdIssue.findMany({ where: { status: "InTransit", lines: { some: { item_id: f.material } } } }));
      if (!waiting) return;
      const r = await receiveStockReceipt(await stockReceiptOf(waiting.issue_no), f.actor, { valueMode: "carried" });
      assert.ok(r.ok, JSON.stringify(r));
      count("terima gudang");
    },
    async () => {
      // A repeat of a message already taken must change nothing.
      const old = pick(await prisma.prdReceipt.findMany({ where: { status: "Received", lines: { some: { item_id: f.material } } } }));
      const back = pick(await prisma.prdIssue.findMany({ where: { status: "Received", lines: { some: { item_id: f.material } } } }));
      await prisma.$transaction(async (tx) => {
        if (old) await deliver(tx, { type: "IssueReceived", no: old.receipt_no, date: today }, f.actor);
        if (back) await deliver(tx, { type: "ReceiptReceived", no: back.issue_no, date: today }, f.actor);
      });
      count("pesan kembar");
    },
  ];
  for (let i = 0; i < 40; i++) {
    await pick(events)();
    const p = await position();
    assert.equal(p.gl, p.production + p.coming, `after event ${i + 1}: ${JSON.stringify(p)} ${JSON.stringify(done)}`);
  }
  for (const k of ["beli", "kirim", "terima unit", "keluar unit", "terima gudang", "pesan kembar"]) assert.ok(done[k] > 0, `${k} never happened: ${JSON.stringify(done)}`);
});
