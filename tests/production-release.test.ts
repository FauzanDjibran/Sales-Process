import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { checkRelease, createRelease, getRelease, releaseOptions, releasePreview, transitionRelease, updateRelease, type ReleaseHeaderInput, type ReleaseLineInput } from "../src/lib/erp/production-release";
import { RELEASE_PURPOSES, availableReleaseActions, releaseAbilities, releasePermission } from "../src/lib/erp/production-release-workflow";
import { enterProduction, startPartai } from "../src/lib/erp/production-ledger";
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
 * What takes goods out of production (Walet step 6, P170, M118): Penerimaan Hasil
 * Produksi puts them into a warehouse **under the same lot** at the value they hold
 * (Dr Persediaan / Cr WIP) and Pemusnahan Produksi writes them off (Dr Beban
 * Pemusnahan / Cr WIP). A line may take part of a bucket, a Reject leaves this way,
 * goods in transit cannot leave, a BJL moves at 0 with no journal, and when the last
 * goods of a Partai have left its Perintah closes itself.
 */

const today = new Date().toISOString().slice(0, 10);
const day = new Date(`${today}T00:00:00Z`);
let actor = 0;
const f = {} as Record<string, number>;
const docs: number[] = [];
const items: number[] = [];
const orders: number[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const cleanups: (() => Promise<unknown>)[] = [];
const savedSettings = new Map<string, string | null>();
let fakeDoc = 700_000 + (Date.now() % 90_000);

async function setMapping(k: string, v: string | null) {
  if (!savedSettings.has(k)) savedSettings.set(k, (await prisma.sysSetting.findUnique({ where: { setting_key: k } }))?.setting_value ?? null);
  await prisma.sysSetting.upsert({ where: { setting_key: k }, update: { setting_value: v }, create: { setting_key: k, setting_value: v, updated_by: actor } });
}

const header = (over: Partial<ReleaseHeaderInput> = {}): ReleaseHeaderInput => ({ purpose: "finished_receipt", release_date: today, workstation_id: f.ws, warehouse_id: f.warehouse, reason: "", note: "", ...over });
const scrapHeader = (over: Partial<ReleaseHeaderInput> = {}) => header({ purpose: "scrap", warehouse_id: null, reason: "kadaluarsa", ...over });
const line = (bucket: number, qty: number | string, location: number | null = null): ReleaseLineInput => ({ bucket_id: bucket, qty, location_id: location });

async function create(h: ReleaseHeaderInput, lines: ReleaseLineInput[]) {
  const r = await createRelease(h, lines, actor);
  if (r.ok) docs.push(r.id);
  return r;
}

/** Goods at the station as an execution leaves them (the lot is in the register too). */
async function atStation(itemId: number, qty: number, value: number, over: { partaiId?: number | null; inTransit?: boolean } = {}) {
  const lot = await stockIn(itemId, f.warehouse, `${key("L")}${fakeDoc}`, 1, 10);
  const docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_release" } })).id;
  const { bucketId } = await prisma.$transaction((tx) =>
    enterProduction(tx, { lotId: lot, itemId, workstationId: f.ws, partaiId: over.partaiId ?? null, inTransit: over.inTransit, baseQty: qty, value, date: day, source: { docTypeId, docId: fakeDoc++, no: "TEST" }, actorId: actor })
  );
  return { lot, bucketId };
}

async function newPartai(withOrder: boolean) {
  const docTypeId = (await prisma.sysDocType.findFirstOrThrow({ where: { doc_table: "prd_release" } })).id;
  let orderId: number | null = null;
  if (withOrder) {
    orderId = (
      await prisma.prdOrder.create({ data: { order_no: `PP_TEST_${stamp}_${fakeDoc++}`, order_date: day, status: "Open", target_item_id: f.fg, target_qty: 10, created_by: actor, steps: { create: [{ step_no: 1, workstation_id: f.ws }] } } })
    ).id;
    orders.push(orderId);
  }
  const partai = await prisma.$transaction((tx) => startPartai(tx, { date: day, orderId, source: { docTypeId, docId: fakeDoc++, no: "TEST" }, actorId: actor }));
  return { partai, orderId };
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  const cc = await productionCostCenterId();
  f.g = (await prisma.refUom.create({ data: { uom_code: `test.${key("G")}`, uom_label: key("G"), uom_name: "Gram", created_by: actor } })).id;
  f.cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BHN-BAKU" } })).id;
  const item = async (l: string, type: "Utama" | "Turunan" | "BJL") => {
    const id = (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: f.cat, base_uom_id: f.g, track_stock: true, output_type: type, created_by: actor },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.fg = await item("FG", "Utama");
  f.k = await item("K", "Turunan");
  f.bs = await item("BS", "BJL");
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang FG", created_by: actor } })).id;
  f.located = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WHL")}`, warehouse_label: key("WHL"), warehouse_name: "Gudang Berlokasi", use_location: true, created_by: actor } })).id;
  f.a01 = (await prisma.refWarehouseLocation.create({ data: { warehouse_id: f.located, location_code: `test.${key("A01")}`, location_label: "A-01", location_name: "Rak A-01", created_by: actor } })).id;
  f.ws = (await prisma.refWorkstation.create({ data: { workstation_code: `test.${key("WS")}`, workstation_label: key("WS"), workstation_name: "Packing", cost_center_id: cc, created_by: actor } })).id;

  const sub = async (label: string) => (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.wipAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.invAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.scrapAcc = await makeAccount({ subcategoryLabel: "5.1.1" });
  cleanups.push(await snapshotCategoryAccounts([f.cat]));
  await setCategoryAccount(f.cat, "Wip", f.wipAcc, actor);
  await setCategoryAccount(f.cat, "Inventory", null, actor);
  await setMapping("inventory_account", String(f.invAcc));
  await setMapping("production_scrap_account", String(f.scrapAcc));
});

after(async () => {
  await prisma.prdReleaseLine.deleteMany({ where: { release_id: { in: docs } } });
  await prisma.prdRelease.deleteMany({ where: { id: { in: docs } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_release", row_id: { in: docs } } });
  await prisma.prdLedger.deleteMany({ where: { item_id: { in: items } } });
  await prisma.prdBalance.deleteMany({ where: { item_id: { in: items } } });
  const partai = await prisma.prdPartai.findMany({ where: { source_no: "TEST", order_id: { in: orders } }, select: { id: true } });
  await prisma.prdPartai.deleteMany({ where: { id: { in: partai.map((p) => p.id) } } });
  await prisma.prdPartai.deleteMany({ where: { source_no: "TEST", order_id: null } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_order", row_id: { in: orders } } });
  await prisma.prdOrderStep.deleteMany({ where: { order_id: { in: orders } } });
  await prisma.prdOrder.deleteMany({ where: { id: { in: orders } } });
  for (const [k, v] of savedSettings) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  for (const c of cleanups) await c();
  await cleanupFixtures();
  await cleanupStock(items);
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: f.ws } });
  await prisma.refWarehouseLocation.deleteMany({ where: { warehouse_id: f.located } });
  await prisma.refWarehouse.deleteMany({ where: { id: { in: [f.warehouse, f.located] } } });
  await prisma.refUom.deleteMany({ where: { id: f.g } });
  await cleanupFiscalYear();
  await disconnect();
});

describe("what a document may be saved with", () => {
  test("a receipt names its warehouse, a scrap its reason; a line is goods the station holds, received, within the bucket", async () => {
    const b = await atStation(f.fg, 100, 1000);
    const none = await create(header({ warehouse_id: null }), []);
    assert.ok(!none.ok && none.errors.warehouse_id && none.errors._lines);
    const noReason = await create(scrapHeader({ reason: "" }), [line(b.bucketId, 10)]);
    assert.ok(!noReason.ok && noReason.errors.reason);
    const over = await create(header(), [line(b.bucketId, 101)]);
    assert.ok(!over.ok && /Melebihi saldo/.test(over.errors["lines.0.qty"]));
    const transit = await atStation(f.fg, 5, 50, { inTransit: true });
    const away = await create(header(), [line(transit.bucketId, 5)]);
    assert.ok(!away.ok, "goods in transit cannot leave");
    const twice = await create(header(), [line(b.bucketId, 5), line(b.bucketId, 5)]);
    assert.ok(!twice.ok && /sudah ada/.test(twice.errors["lines.1.bucket_id"]));
  });

  test("the purposes carry their own number, route and permissions", () => {
    assert.equal(RELEASE_PURPOSES.finished_receipt.prefix, "PHP");
    assert.equal(RELEASE_PURPOSES.scrap.prefix, "PMS");
    assert.equal(releasePermission("scrap", "post"), "PRODUCTION_SCRAP_POST");
    assert.equal(releasePermission("finished_receipt", "view"), "PRODUCTION_RECEIPT_VIEW");
    const can = releaseAbilities("scrap", ["PRODUCTION_SCRAP_POST", "PRODUCTION_RECEIPT_CANCEL"]);
    assert.deepEqual(availableReleaseActions("Draft", can), ["post"]);
    assert.deepEqual(availableReleaseActions("Posted", can), []);
  });

  test("the options hold received goods only, with each warehouse's locations", async () => {
    const o = await releaseOptions();
    assert.ok(o.buckets.every((b) => !b.inTransit));
    assert.equal(o.warehouses.find((w) => w.id === f.located)!.locations[0].id, f.a01);
    assert.equal(o.warehouses.find((w) => w.id === f.warehouse)!.useLocation, false);
  });
});

describe("Penerimaan Hasil Produksi: the lot is kept, the value is what the goods hold", () => {
  test("part of a bucket goes to stock under the same lot; Dr Persediaan / Cr WIP; the dry run equals it", async () => {
    const { partai } = await newPartai(false);
    const b = await atStation(f.fg, 100, 1000, { partaiId: partai.id });
    const r = await create(header(), [line(b.bucketId, 40)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.releaseNo, /^PHP_.+_\d{6}_\d{5}$/, "the unit's number (M124)");
    f.r1 = r.id;
    const preview = await releasePreview(f.r1, actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.equal(await prisma.logStockBalance.count({ where: { tracking_id: b.lot, warehouse_id: f.warehouse, qty_balance: { gt: 1 } } }), 0, "a dry run writes nothing");
    assert.ok((await transitionRelease(f.r1, "post", actor)).ok);

    const bucket = await prisma.prdBalance.findUniqueOrThrow({ where: { id: b.bucketId } });
    assert.deepEqual([bucket.qty_balance.toNumber(), bucket.value_balance.toNumber()], [60, 600], "round(V × q ÷ Q) left, the rest stays");
    const stock = await prisma.logStockBalance.findFirstOrThrow({ where: { tracking_id: b.lot, warehouse_id: f.warehouse } });
    assert.equal(stock.qty_balance.toNumber(), 41, "the goods came in under the lot they already had (1 injected + 40)");
    assert.equal(await prisma.logStockTracking.count({ where: { item_id: f.fg, tracking_no: (await prisma.logStockTracking.findUniqueOrThrow({ where: { id: b.lot } })).tracking_no } }), 1, "one register row");

    const v = (await getRelease(f.r1))!;
    assert.equal(v.status, "Posted");
    assert.equal(v.totalValue, 400);
    assert.deepEqual(v.lines.map((l) => l.cost), [400]);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! } });
    const dr = lines.filter((l) => l.debit_amount.toNumber() > 0);
    const cr = lines.filter((l) => l.kredit_amount.toNumber() > 0);
    assert.deepEqual([dr[0].account_id, dr[0].debit_amount.toNumber(), cr[0].account_id, cr[0].kredit_amount.toNumber()], [f.invAcc, 400, f.wipAcc, 400]);
  });

  test("a BJL at 0 moves with no journal; a posted document is final", async () => {
    const b = await atStation(f.bs, 50, 0);
    const r = await create(header(), [line(b.bucketId, 50)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await transitionRelease(r.id, "post", actor)).ok);
    const v = (await getRelease(r.id))!;
    assert.equal(v.journalId, null, "nothing changes in the books");
    assert.equal(v.totalValue, 0);
    assert.equal((await prisma.prdBalance.findUniqueOrThrow({ where: { id: b.bucketId } })).qty_balance.toNumber(), 0);
    assert.ok(!(await updateRelease(r.id, header(), [line(b.bucketId, 1)], actor)).ok);
    assert.ok(!(await transitionRelease(r.id, "cancel", actor, "x")).ok);
  });

  test("a warehouse that keeps locations needs the place of each line at Posting", async () => {
    const b = await atStation(f.k, 30, 300);
    const r = await create(header({ warehouse_id: f.located }), [line(b.bucketId, 30)]);
    assert.ok(r.ok, "a Draft may leave the place empty");
    const noPlace = await transitionRelease(r.id, "post", actor);
    assert.ok(!noPlace.ok && /Pilih lokasi/.test(noPlace.errors._form), JSON.stringify(noPlace));
    assert.ok((await updateRelease(r.id, header({ warehouse_id: f.located }), [line(b.bucketId, 30, f.a01)], actor)).ok);
    assert.ok((await transitionRelease(r.id, "post", actor)).ok);
    const stock = await prisma.logStockBalance.findFirstOrThrow({ where: { tracking_id: b.lot, warehouse_id: f.located } });
    assert.equal(stock.location_id, f.a01);
  });
});

describe("Pemusnahan Produksi writes goods off", () => {
  test("Dr Beban Pemusnahan / Cr WIP, the bucket emptied, no stock", async () => {
    const b = await atStation(f.fg, 20, 777);
    const r = await create(scrapHeader(), [line(b.bucketId, 20)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.releaseNo, /^PMS_/);
    assert.ok((await transitionRelease(r.id, "post", actor)).ok);
    const v = (await getRelease(r.id))!;
    assert.equal(v.totalValue, 777);
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! } });
    assert.deepEqual(lines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]).sort(), [[f.scrapAcc, 777, 0], [f.wipAcc, 0, 777]].sort());
    assert.deepEqual([(await prisma.prdBalance.findUniqueOrThrow({ where: { id: b.bucketId } })).qty_balance.toNumber()], [0]);
    assert.equal(await prisma.logStockBalance.count({ where: { tracking_id: b.lot, qty_balance: { gt: 1 } } }), 0, "nothing came into stock");
  });

  test("a missing WIP account is named", async () => {
    const b = await atStation(f.fg, 5, 50);
    const r = await create(scrapHeader(), [line(b.bucketId, 5)]);
    assert.ok(r.ok);
    await setCategoryAccount(f.cat, "Wip", null, actor);
    const refused = await transitionRelease(r.id, "post", actor);
    assert.ok(!refused.ok && /Account WIP/.test(refused.errors._form), JSON.stringify(refused));
    await setCategoryAccount(f.cat, "Wip", f.wipAcc, actor);
  });
});

describe("the Perintah of a Partai closes itself when the last goods have left", () => {
  test("a Reject leaves through a scrap; only then is the Partai out and its Perintah Ditutup", async () => {
    const { partai, orderId } = await newPartai(true);
    const good = await atStation(f.fg, 10, 100, { partaiId: partai.id });
    const reject = await atStation(f.fg, 4, 0, { partaiId: partai.id });
    await prisma.prdBalance.update({ where: { id: reject.bucketId }, data: { is_reject: true } });

    const first = await create(header(), [line(good.bucketId, 10)]);
    assert.ok(first.ok && (await transitionRelease(first.id, "post", actor)).ok);
    assert.equal((await prisma.prdOrder.findUniqueOrThrow({ where: { id: orderId! } })).status, "Open", "the Reject is still in production (O6)");

    const second = await create(scrapHeader(), [line(reject.bucketId, 4)]);
    assert.ok(second.ok && (await transitionRelease(second.id, "post", actor)).ok);
    const order = await prisma.prdOrder.findUniqueOrThrow({ where: { id: orderId! } });
    assert.equal(order.status, "Closed");
    assert.equal(await prisma.auditLog.count({ where: { entity_key: "prd_order", row_id: orderId!, event: "finish" } }), 1);
  });
});

describe("a Draft", () => {
  test("is edited whole; Batalkan needs a reason; its station and the check are exported", async () => {
    const b = await atStation(f.fg, 9, 90);
    const r = await create(header(), [line(b.bucketId, 9)]);
    assert.ok(r.ok);
    const upd = await updateRelease(r.id, header({ note: "x" }), [line(b.bucketId, 4)], actor);
    assert.ok(upd.ok && upd.releaseNo === r.releaseNo);
    assert.equal((await getRelease(r.id))!.lines[0].qty, "4");
    assert.ok(!(await transitionRelease(r.id, "cancel", actor, "")).ok);
    assert.ok((await transitionRelease(r.id, "cancel", actor, "salah")).ok);
    assert.equal((await getRelease(r.id))!.status, "Cancelled");
    assert.ok(checkRelease);
  });
});
