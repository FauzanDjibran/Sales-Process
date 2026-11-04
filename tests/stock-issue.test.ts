import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createStockIssue,
  getStockIssue,
  stockIssueOptions,
  stockIssuePreview,
  transitionStockIssue,
  updateStockIssue,
  type StockIssueHeaderInput,
  type StockIssueLineInput,
} from "../src/lib/erp/stock-issue";
import { cleanupFiscalYear, cleanupFixtures, disconnect, openFiscalYear, prisma } from "./helpers";
import { makeProductionFixture, type ProductionFixture } from "./production-helpers";

/**
 * The BSTB Issue (P228): material leaves a warehouse lot by lot into a Unit, at
 * the value the stock books release, under the same lot. What may be saved;
 * that Ajukan needs every line picked in full and a WIP account on the item's
 * category (no fallback, R16) and locks the goods without moving them; that
 * Terima writes Dr WIP / Cr Persediaan and the dry run equals it; that short
 * stock is refused.
 */

const today = new Date().toISOString().slice(0, 10);
let f: ProductionFixture;
const ids: number[] = [];

const header = (over: Partial<StockIssueHeaderInput> = {}): StockIssueHeaderInput => ({ purpose: "auxiliary_issue", warehouse_id: f.warehouse, unit_id: f.wsA, issue_date: today, note: "", ...over });
const line = (qty: number, picks: { lot: number; qty: number }[], itemId = f.material): StockIssueLineInput => ({
  item_id: itemId,
  qty,
  note: "",
  picks: picks.map((p) => ({ tracking_id: p.lot, location_id: null, qty: p.qty })),
});
async function create(h: StockIssueHeaderInput, lines: StockIssueLineInput[]) {
  const r = await createStockIssue(h, lines, f.actor);
  if (r.ok) ids.push(r.id);
  return r;
}

before(async () => {
  await openFiscalYear();
  f = await makeProductionFixture("SI");
});

after(async () => {
  await prisma.logStockIssueTracking.deleteMany({ where: { line: { stock_issue_id: { in: ids } } } });
  await prisma.logStockIssueLine.deleteMany({ where: { stock_issue_id: { in: ids } } });
  await prisma.logStockIssue.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_stock_issue", row_id: { in: ids } } });
  await f.teardown();
  await cleanupFixtures();
  await cleanupFiscalYear();
  await disconnect();
});

describe("a Stock Issue is checked before it is saved", () => {
  test("it names a warehouse, a unit and items picked within their quantity", async () => {
    const r = await create(header({ unit_id: null }), [line(10, [{ lot: f.lot, qty: 11 }])]);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.match(r.errors.unit_id, /Unit/);
      assert.match(r.errors["lines.0.picks"], /melebihi/);
    }
  });

  test("a Draft may be picked in part; Ajukan needs it in full, and only a submitted one is received", async () => {
    const r = await create(header(), [line(10, [{ lot: f.lot, qty: 4 }])]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(!(await transitionStockIssue(r.id, "post", f.actor)).ok);
    const p = await transitionStockIssue(r.id, "submit", f.actor);
    assert.ok(!p.ok && /Pilih lot sampai penuh/.test(p.errors._form));
    assert.ok((await transitionStockIssue(r.id, "cancel", f.actor, "uji")).ok);
  });
});

describe("Ajukan locks the goods, Terima moves them (W20, A1)", () => {
  test("a category without a WIP account is refused by name (R16)", async () => {
    const r = await create(header(), [line(300, [{ lot: f.lot, qty: 300 }])]);
    assert.ok(r.ok, JSON.stringify(r));
    ids.push(r.id);
    await prisma.accItemCategoryAccount.update({ where: { category_id: f.category }, data: { wip_account_id: null } });
    try {
      const p = await transitionStockIssue(r.id, "submit", f.actor);
      assert.ok(!p.ok && /Account WIP/.test(p.errors._form));
    } finally {
      await prisma.accItemCategoryAccount.update({ where: { category_id: f.category }, data: { wip_account_id: f.wipAcc } });
    }
    const updated = await updateStockIssue(r.id, header(), [line(300, [{ lot: f.lot, qty: 300 }])], f.actor);
    assert.ok(updated.ok);
  });

  test("Ajukan moves nothing, and what it holds is not free for anyone else", async () => {
    const id = ids.at(-1)!;
    assert.ok((await transitionStockIssue(id, "submit", f.actor)).ok);
    assert.equal((await getStockIssue(id))!.status, "Submitted");
    const bucket = await prisma.logStockBalance.findFirstOrThrow({ where: { tracking_id: f.lot } });
    assert.deepEqual([bucket.qty_balance.toNumber(), bucket.reserved_qty.toNumber()], [1000, 300]);
    assert.equal(await prisma.prdLedger.count({ where: { tracking_id: f.lot } }), 0, "nothing in the Unit before Terima");
    const offered = (await stockIssueOptions()).lots[f.warehouse][f.material][0];
    assert.equal(offered.available, 700);
    const other = await create(header(), [line(701, [{ lot: f.lot, qty: 701 }])]);
    assert.ok(other.ok, JSON.stringify(other));
    const refused = await transitionStockIssue(other.id, "submit", f.actor);
    assert.ok(!refused.ok && /tersedia 700/.test(refused.errors._form));
    await transitionStockIssue(other.id, "cancel", f.actor, "uji");
    assert.ok(!(await transitionStockIssue(id, "cancel", f.actor, "x")).ok, "Batalkan is for a Draft");
    ids.push(ids.splice(ids.indexOf(id), 1)[0]);
  });

  test("the preview is the journal Terima writes: Dr WIP / Cr Persediaan at moving average", async () => {
    const id = ids.at(-1)!;
    const preview = await stockIssuePreview(id, f.actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    if (preview.ok) assert.deepEqual(preview.lines.map((l) => [l.debit, l.credit]), [[300_000, 0], [0, 300_000]]);
    assert.equal((await getStockIssue(id))!.status, "Submitted");
    assert.ok((await transitionStockIssue(id, "post", f.actor)).ok);
    const v = (await getStockIssue(id))!;
    assert.equal(v.status, "Posted");
    assert.equal(v.cost, 300_000);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]), [[f.wipAcc, 300_000, 0], [f.inventoryAcc, 0, 300_000]]);
    const bucket = await prisma.prdBalance.findFirstOrThrow({ where: { tracking_id: f.lot, unit_id: f.wsA } });
    assert.deepEqual([bucket.qty_balance.toNumber(), bucket.value_balance.toNumber()], [300, 300_000], "the same lot, at the unit");
    assert.equal(bucket.stage, "Preparation");
    assert.equal(bucket.partai_id, null, "a Unit's balance, not a partai's contents");
    assert.equal((await prisma.logStockBalance.findFirstOrThrow({ where: { tracking_id: f.lot } })).reserved_qty.toNumber(), 0);
    assert.match(v.issueNo, /^BSTB_.+_\d{6}_\d{5}$/);
    const pick = await prisma.logStockIssueTracking.findFirstOrThrow({ where: { line: { stock_issue_id: id } } });
    assert.equal(pick.prd_bucket_id, bucket.id);
  });

  test("short stock is refused, and a posted issue is final", async () => {
    const r = await create(header(), [line(800, [{ lot: f.lot, qty: 800 }])]);
    assert.ok(!r.ok || !(await transitionStockIssue(r.id, "submit", f.actor)).ok, "only 700 left in the lot");
    const posted = ids[ids.length - (r.ok ? 2 : 1)];
    assert.ok(!(await updateStockIssue(posted, header(), [line(1, [{ lot: f.lot, qty: 1 }])], f.actor)).ok);
    assert.ok(!(await transitionStockIssue(posted, "cancel", f.actor, "x")).ok);
  });
});

describe("which Unit takes what", () => {
  test("material enters at the first Unit of the routing; bahan penolong at any Unit", async () => {
    const existing = await prisma.prdRouting.findFirst({ where: { line_id: null } });
    const own = existing
      ? null
      : await prisma.prdRouting.create({
          data: {
            routing_code: `test.${f.key("SG")}`,
            routing_label: f.key("SG"),
            routing_name: "Segmen",
            created_by: f.actor,
            steps: { create: [{ seq: 1, unit_id: f.wsB }] },
          },
        });
    try {
      const wrong = await create(header({ purpose: "production_issue", unit_id: f.wsA }), [line(1, [{ lot: f.lot, qty: 1 }])]);
      assert.ok(!wrong.ok && /Unit pertama routing/.test(wrong.errors.unit_id));
      const aux = await create(header({ unit_id: f.wsA }), [line(1, [{ lot: f.lot, qty: 1 }])]);
      assert.ok(aux.ok, "bahan penolong goes to any Unit");
      await transitionStockIssue(aux.id, "cancel", f.actor, "uji");
      if (own) {
        const right = await create(header({ purpose: "production_issue", unit_id: f.wsB }), [line(1, [{ lot: f.lot, qty: 1 }])]);
        assert.ok(right.ok, JSON.stringify(right));
        await transitionStockIssue(right.id, "cancel", f.actor, "uji");
      }
    } finally {
      if (own) {
        await prisma.prdRoutingStep.deleteMany({ where: { routing_id: own.id } });
        await prisma.prdRouting.delete({ where: { id: own.id } });
      }
    }
  });

  test("a Draft that changes its Unit takes that Unit's number", async () => {
    const r = await create(header(), [line(1, [{ lot: f.lot, qty: 1 }])]);
    assert.ok(r.ok);
    const moved = await updateStockIssue(r.id, header({ unit_id: f.wsB }), [line(1, [{ lot: f.lot, qty: 1 }])], f.actor);
    assert.ok(moved.ok && moved.issueNo !== r.issueNo);
    await transitionStockIssue(r.id, "cancel", f.actor, "uji");
  });
});
