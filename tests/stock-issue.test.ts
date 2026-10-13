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
import { availableStockIssueActions, stockIssueAbilities } from "../src/lib/erp/stock-issue-workflow";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  cleanupStock,
  disconnect,
  makeAccount,
  openFiscalYear,
  prisma,
  setCategoryAccount,
  snapshotCategoryAccounts,
  stockIn,
  systemUserId,
} from "./helpers";

/**
 * The Stock Issue (P158; `production_project.md` §9.3, *Pengeluaran ke
 * Produksi*): material leaves a warehouse lot by lot and enters production at
 * a workstation under the same lot number, at the value the stock books
 * release (moving average, P114). What may be saved; that Posting needs every
 * line picked in full and a WIP account on the item's category (no fallback,
 * M62); that it writes Dr WIP / Cr Persediaan and the dry run equals it; that
 * short stock is refused; and that a second issue of a lot to the same
 * workstation adds to its bucket.
 */

const today = new Date().toISOString().slice(0, 10);
let actor = 0;
const f = {} as Record<string, number>;
const ids: number[] = [];
const cleanups: (() => Promise<unknown>)[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const items: number[] = [];
const savedSettings = new Map<string, string | null>();

async function setMapping(k: string, v: string | null) {
  if (!savedSettings.has(k)) savedSettings.set(k, (await prisma.sysSetting.findUnique({ where: { setting_key: k } }))?.setting_value ?? null);
  await prisma.sysSetting.upsert({ where: { setting_key: k }, update: { setting_value: v }, create: { setting_key: k, setting_value: v, updated_by: actor } });
}

const header = (over: Partial<StockIssueHeaderInput> = {}): StockIssueHeaderInput => ({
  warehouse_id: f.warehouse,
  workstation_id: f.ws,
  issue_date: today,
  note: "",
  ...over,
});
const line = (itemId: number, qty: number, picks: { lot: number; qty: number; location?: number | null }[]): StockIssueLineInput => ({
  item_id: itemId,
  qty,
  note: "",
  picks: picks.map((p) => ({ lot_id: p.lot, location_id: p.location ?? null, qty: p.qty })),
});

async function create(h = header(), lines: StockIssueLineInput[]) {
  const r = await createStockIssue(h, lines, actor);
  if (r.ok) ids.push(r.id);
  return r;
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.kg = (await prisma.refUom.create({ data: { uom_code: `test.${key("KG")}`, uom_label: key("KG"), uom_name: "Kg", created_by: actor } })).id;
  f.cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BHN-BAKU" } })).id;
  const item = async (l: string, track = true, expiry = false) => {
    const id = (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: f.cat, base_uom_id: f.kg, track_stock: track, has_expiry: expiry, created_by: actor },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.rm = await item("RM");
  f.exp = await item("EXP", true, true);
  f.plain = await item("PLAIN", false);
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang Bahan", created_by: actor } })).id;
  f.located = (
    await prisma.refWarehouse.create({
      data: { warehouse_code: `test.${key("WHL")}`, warehouse_label: key("WHL"), warehouse_name: "Gudang Berlokasi", use_location: true, created_by: actor },
    })
  ).id;
  f.a01 = (
    await prisma.refWarehouseLocation.create({
      data: { warehouse_id: f.located, location_code: `test.${key("A01")}`, location_label: "A-01", location_name: "Rak A-01", created_by: actor },
    })
  ).id;
  f.ws = (await prisma.refWorkstation.create({ data: { workstation_code: `test.${key("WS")}`, workstation_label: key("WS"), workstation_name: "Pengolahan", created_by: actor } })).id;
  f.wsOff = (
    await prisma.refWorkstation.create({ data: { workstation_code: `test.${key("WSOFF")}`, workstation_label: key("WSOFF"), workstation_name: "Mati", status: "Inactive", created_by: actor } })
  ).id;

  // RM's pool is company-wide (P114): 100 kg at Rp 1.000.000 in R1, 50 kg at
  // Rp 600.000 in R2 and 10 kg at Rp 100.000 in the located warehouse — 160 kg
  // at Rp 1.700.000, 10.625 per kg whichever lot leaves.
  f.r1 = await stockIn(f.rm, f.warehouse, key("R1"), 100, 1_000_000);
  f.r2 = await stockIn(f.rm, f.warehouse, key("R2"), 50, 600_000);
  f.e1 = await stockIn(f.exp, f.warehouse, key("E1"), 20, 200_000, "2027-12-31");
  await injectLocated();

  const sub = async (label: string) =>
    (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.invAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.wipAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  await setMapping("inventory_account", String(f.invAcc));
  cleanups.push(await snapshotCategoryAccounts([f.cat]));
  // The category names no account of its own: Persediaan falls back to Account
  // Mapping; WIP has no fallback until a test sets it.
  await setCategoryAccount(f.cat, "Inventory", null, actor);
  await setCategoryAccount(f.cat, "Wip", null, actor);
});

/** 10 kg of RM in the located warehouse, location A-01, lot L1. */
async function injectLocated() {
  const { injectStock } = await import("../src/lib/erp/inventory");
  await injectStock(
    [{ itemId: f.rm, warehouseId: f.located, locationId: f.a01, lotNo: key("L1"), expiry: null, qty: "10", value: "100000", date: new Date(`${today}T00:00:00Z`) }],
    actor
  );
  f.l1 = (await prisma.logStockTracking.findUniqueOrThrow({ where: { item_id_tracking_no: { item_id: f.rm, tracking_no: key("L1").toUpperCase() } } })).id;
}

after(async () => {
  await prisma.logStockIssueLot.deleteMany({ where: { line: { stock_issue_id: { in: ids } } } });
  await prisma.logStockIssueLine.deleteMany({ where: { stock_issue_id: { in: ids } } });
  await prisma.logStockIssue.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_stock_issue", row_id: { in: ids } } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdLot.deleteMany({ where: { item_id: { in: items } } });
  for (const [k, v] of savedSettings) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  // The category's mapping names fixture accounts: put it back before they go.
  for (const c of cleanups) await c();
  await cleanupFixtures();
  await cleanupStock(items);
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: { in: [f.ws, f.wsOff] } } });
  await prisma.refWarehouseLocation.deleteMany({ where: { warehouse_id: f.located } });
  await prisma.refWarehouse.deleteMany({ where: { id: { in: [f.warehouse, f.located] } } });
  await prisma.refUom.deleteMany({ where: { id: f.kg } });
  await cleanupFiscalYear();
  await disconnect();
});

describe("what a Stock Issue may be saved with", () => {
  test("the form offers only Barang with Kelola Stok, and each one's lots per warehouse", async () => {
    const o = await stockIssueOptions();
    assert.ok(o.items.some((i) => i.id === f.rm));
    assert.ok(!o.items.some((i) => i.id === f.plain), "a Barang without Kelola Stok never leaves by lot");
    assert.ok(o.workstations.some((w) => w.id === f.ws));
    assert.ok(!o.workstations.some((w) => w.id === f.wsOff), "an inactive workstation is not offered");
    assert.deepEqual(o.lots[f.warehouse][f.rm].map((l) => [l.id, l.available]).sort(), [[f.r1, 100], [f.r2, 50]].sort());
    assert.equal(o.lots[f.located][f.rm][0].locationId, f.a01);
  });

  test("warehouse, workstation, a line and a quantity are required; an item once; no plain Barang", async () => {
    const empty = await create(header({ warehouse_id: null, workstation_id: null }), []);
    assert.ok(!empty.ok);
    assert.ok(empty.errors.warehouse_id && empty.errors.workstation_id && empty.errors._lines);
    const off = await create(header({ workstation_id: f.wsOff }), [line(f.rm, 1, [])]);
    assert.ok(!off.ok && off.errors.workstation_id);
    const bad = await create(header(), [line(f.rm, 0, []), line(f.plain, 1, []), line(f.rm, 1, [])]);
    assert.ok(!bad.ok);
    assert.ok(bad.errors["lines.0.qty"]);
    assert.match(bad.errors["lines.1.item_id"], /Kelola Stok/);
    assert.match(bad.errors["lines.2.item_id"], /lebih dari sekali/, "an item once per issue");
  });

  test("picks are lots of the warehouse, never more than the line; a Draft may be picked in part", async () => {
    const over = await create(header(), [line(f.rm, 10, [{ lot: f.r1, qty: 11 }])]);
    assert.ok(!over.ok && /melebihi/.test(over.errors["lines.0.picks"]));
    const elsewhere = await create(header(), [line(f.rm, 5, [{ lot: f.l1, qty: 5, location: f.a01 }])]);
    assert.ok(!elsewhere.ok && /tidak ada di gudang/.test(elsewhere.errors["lines.0.picks"]));
    const part = await create(header(), [line(f.rm, 30, [{ lot: f.r1, qty: 10 }])]);
    assert.ok(part.ok, JSON.stringify(part));
    assert.match(part.issueNo, /^SI\/\d{4}\/\d{2}\/\d{4}$/);
    f.part = part.id;
  });
});

describe("posting moves the goods from stock into production (Dr WIP / Cr Persediaan)", () => {
  test("a category without a WIP account is refused by name (M62); then a line not picked in full", async () => {
    const noWip = await transitionStockIssue(f.part, "post", actor);
    assert.ok(!noWip.ok && /Account WIP/.test(noWip.errors._form), JSON.stringify(noWip));
    await setCategoryAccount(f.cat, "Wip", f.wipAcc, actor);
    const short = await transitionStockIssue(f.part, "post", actor);
    assert.ok(!short.ok && /sampai penuh/.test(short.errors._form), JSON.stringify(short));
    const upd = await updateStockIssue(f.part, header(), [line(f.rm, 30, [{ lot: f.r1, qty: 30 }])], actor);
    assert.ok(upd.ok, JSON.stringify(upd));
  });

  test("the dry run shows the journal and writes nothing (P103)", async () => {
    const p = await stockIssuePreview(f.part, actor);
    assert.ok(p.ok, JSON.stringify(p));
    assert.equal(p.lines.length, 2);
    assert.equal(await prisma.prdBalance.count({ where: { item_id: f.rm } }), 0, "nothing entered production");
    assert.equal((await getStockIssue(f.part))!.status, "Draft");
  });

  test("each lot leaves at the moving average and enters production at the workstation under its own number", async () => {
    const r = await transitionStockIssue(f.part, "post", actor);
    assert.deepEqual(r, { ok: true });
    const v = (await getStockIssue(f.part))!;
    assert.equal(v.status, "Posted");
    // 1.700.000 × 30 ÷ 160 = 318.750
    assert.equal(v.cost, 318_750);
    assert.equal(v.lines[0].unitCost, 10_625);
    const bucket = await prisma.prdBalance.findFirstOrThrow({ where: { item_id: f.rm, workstation_id: f.ws }, include: { lot: true } });
    assert.equal(bucket.lot.lot_no, key("R1").toUpperCase());
    assert.equal(bucket.lot.origin, "Issued");
    assert.deepEqual([bucket.qty_balance.toNumber(), bucket.value_balance.toNumber()], [30, 318_750]);
    const pick = await prisma.logStockIssueLot.findFirstOrThrow({ where: { line: { stock_issue_id: f.part } } });
    assert.equal(pick.prd_bucket_id, bucket.id);
    assert.equal(pick.prd_lot_id, bucket.lot_id);

    const journal = await prisma.accJournal.findUniqueOrThrow({ where: { id: v.journalId! }, include: { lines: true } });
    const wip = journal.lines.find((l) => l.account_id === f.wipAcc)!;
    const inv = journal.lines.find((l) => l.account_id === f.invAcc)!;
    assert.deepEqual([wip.debit_amount.toNumber(), inv.kredit_amount.toNumber()], [318_750, 318_750]);
    const stock = await prisma.logStockBalance.findFirstOrThrow({ where: { item_id: f.rm, tracking_id: f.r1, warehouse_id: f.warehouse } });
    assert.equal(stock.qty_balance.toNumber(), 70);
    assert.deepEqual(availableStockIssueActions("Posted", stockIssueAbilities(["STOCK_ISSUE_POST", "STOCK_ISSUE_CANCEL"])), []);
  });

  test("a second issue of the same lot to the same workstation adds to its bucket; a lot with expiry keeps it", async () => {
    const r = await create(header(), [line(f.rm, 70, [{ lot: f.r1, qty: 20 }, { lot: f.r2, qty: 50 }]), line(f.exp, 5, [{ lot: f.e1, qty: 5 }])]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(await transitionStockIssue(r.id, "post", actor), { ok: true });
    const r1 = await prisma.prdBalance.findFirstOrThrow({ where: { item_id: f.rm, workstation_id: f.ws, lot: { lot_no: key("R1").toUpperCase() } } });
    // The pool held 130 kg at 1.381.250 after the first issue: 20 kg release
    // 212.500, so lot R1's bucket at the workstation holds 50 kg at 531.250.
    assert.deepEqual([r1.qty_balance.toNumber(), r1.value_balance.toNumber()], [50, 531_250]);
    const lot = await prisma.prdLot.findFirstOrThrow({ where: { item_id: f.exp } });
    assert.equal(lot.expiry_date?.toISOString().slice(0, 10), "2027-12-31");
    const v = (await getStockIssue(r.id))!;
    // Then 50 kg of R2 release round(1.168.750 × 50 ÷ 110) = 531.250.
    assert.equal(v.lines[0].cost, 212_500 + 531_250);
  });

  test("short stock is refused with both figures; a location warehouse issues from its location", async () => {
    const bad = await create(header({ warehouse_id: f.located }), [line(f.rm, 10, [{ lot: f.l1, qty: 10, location: f.a01 }])]);
    assert.ok(bad.ok, JSON.stringify(bad));
    // Someone else takes 5 kg first.
    const first = await create(header({ warehouse_id: f.located }), [line(f.rm, 5, [{ lot: f.l1, qty: 5, location: f.a01 }])]);
    assert.ok(first.ok);
    assert.deepEqual(await transitionStockIssue(first.id, "post", actor), { ok: true });
    const shortPost = await transitionStockIssue(bad.id, "post", actor);
    assert.ok(!shortPost.ok && /tidak cukup: tersedia 5, diminta 10/.test(shortPost.errors._form), JSON.stringify(shortPost));
    assert.equal((await getStockIssue(bad.id))!.status, "Draft", "a refused posting leaves the Draft as it was");
  });

  test("Batalkan needs a reason and touches nothing else", async () => {
    const r = await create(header(), [line(f.exp, 1, [])]);
    assert.ok(r.ok);
    const noWhy = await transitionStockIssue(r.id, "cancel", actor, " ");
    assert.ok(!noWhy.ok && noWhy.errors.reason);
    assert.deepEqual(await transitionStockIssue(r.id, "cancel", actor, "Salah gudang"), { ok: true });
    const v = (await getStockIssue(r.id))!;
    assert.deepEqual([v.status, v.cancelReason, v.journalId], ["Cancelled", "Salah gudang", null]);
    const again = await updateStockIssue(r.id, header(), [line(f.exp, 1, [])], actor);
    assert.ok(!again.ok);
  });
});
