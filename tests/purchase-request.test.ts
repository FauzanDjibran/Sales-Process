import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkPurchaseRequest,
  createPurchaseRequest,
  getPurchaseRequest,
  listPurchaseRequests,
  purchaseRequestOptions,
  recordPurchaseRequestOrdered,
  transitionPurchaseRequest,
  updatePurchaseRequest,
  type PurchaseRequestHeaderInput,
  type PurchaseRequestLineInput,
} from "../src/lib/erp/purchase-request";
import { availablePurchaseRequestActions, purchaseRequestAbilities } from "../src/lib/erp/purchase-request-workflow";
import { FIXTURE_PREFIX, disconnect, prisma, systemUserId } from "./helpers";

/**
 * The Purchase Request (P123, Purchasing-Concept.md B6–B8): Barang or Jasa,
 * items marked Dapat Dibeli in their base unit, a Tanggal Dibutuhkan per line,
 * Draft → Open with no approval, closed by hand or by itself once fully
 * ordered. It posts nothing.
 */

let actor = 0;
const f = {} as Record<string, number>;
const ids: number[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

const header = (over: Partial<PurchaseRequestHeaderInput> = {}): PurchaseRequestHeaderInput => ({
  item_type: "Barang",
  request_date: "2026-10-06",
  needed_date: "2026-10-20",
  requester: "Produksi",
  warehouse_id: f.wh,
  note: "",
  ...over,
});
const line = (item: number, qty: number | string, needed = "2026-10-20"): PurchaseRequestLineInput => ({ item_id: item, qty, needed_date: needed, note: "" });

async function create(h = header(), lines = [line(f.goods, 10)]) {
  const r = await createPurchaseRequest(h, lines, actor);
  if (r.ok) ids.push(r.id);
  return r;
}

before(async () => {
  actor = await systemUserId();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const goodsCat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BHN-BAKU" } })).id;
  const serviceCat = (await prisma.sysItemCategory.findFirstOrThrow({ where: { item_type: "Jasa" } })).id;
  const item = async (l: string, type: "Barang" | "Jasa", canBuy = true) =>
    (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: type, category_id: type === "Barang" ? goodsCat : serviceCat, base_uom_id: f.pcs, can_buy: canBuy, can_sell: false, created_by: actor },
      })
    ).id;
  f.goods = await item("GOODS", "Barang");
  f.other = await item("OTHER", "Barang");
  f.notBought = await item("NOTBUY", "Barang", false);
  f.service = await item("SERVICE", "Jasa");
  f.wh = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang Uji", created_by: actor } })).id;
});

after(async () => {
  await prisma.purRequestLine.deleteMany({ where: { request_id: { in: ids } } });
  await prisma.purRequest.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "pur_request", row_id: { in: ids } } });
  await prisma.mItem.deleteMany({ where: { id: { in: [f.goods, f.other, f.notBought, f.service] } } });
  await prisma.refWarehouse.deleteMany({ where: { id: f.wh } });
  await prisma.refUom.deleteMany({ where: { id: f.pcs } });
  await disconnect();
});

describe("what a Purchase Request offers and must satisfy", () => {
  test("the form offers items of its own type marked Dapat Dibeli, with their base unit", async () => {
    const goods = await purchaseRequestOptions("Barang");
    const mine = goods.items.filter((i) => [f.goods, f.notBought, f.service].includes(i.id));
    assert.deepEqual(mine.map((i) => [i.id, i.uomId]), [[f.goods, f.pcs]], "a Jasa and an item not bought are not offered");
    assert.ok((await purchaseRequestOptions("Jasa")).items.some((i) => i.id === f.service));
  });

  test("items of its type that can be bought, a quantity, a date not before the request", async () => {
    const wrongType = await checkPurchaseRequest(prisma, header(), [line(f.service, 1)]);
    assert.ok(!wrongType.ok && /bukan barang yang dapat dibeli/.test(wrongType.errors["lines.0.item_id"]));
    const notBought = await checkPurchaseRequest(prisma, header(), [line(f.notBought, 1)]);
    assert.ok(!notBought.ok && /dapat dibeli/.test(notBought.errors["lines.0.item_id"]));
    const blank = await checkPurchaseRequest(prisma, header(), [line(f.goods, "")]);
    assert.ok(!blank.ok && blank.errors["lines.0.qty"]);
    const early = await checkPurchaseRequest(prisma, header(), [line(f.goods, 1, "2026-10-01")]);
    assert.ok(!early.ok && /sebelum tanggal Purchase Request/.test(early.errors["lines.0.needed_date"]));
    const none = await checkPurchaseRequest(prisma, header(), []);
    assert.ok(!none.ok && none.errors._lines);
  });

  test("an item may be asked for on two dates, never twice for one date", async () => {
    const twice = await checkPurchaseRequest(prisma, header(), [line(f.goods, 1), line(f.goods, 2)]);
    assert.ok(!twice.ok && /tanggal yang sama/.test(twice.errors["lines.1.item_id"]));
    assert.ok((await checkPurchaseRequest(prisma, header(), [line(f.goods, 1), line(f.goods, 2, "2026-11-01")])).ok);
  });

  test("a Jasa request keeps no warehouse; a blank line date takes the header's", async () => {
    const r = await checkPurchaseRequest(prisma, header({ item_type: "Jasa" }), [{ item_id: f.service, qty: 1, needed_date: "", note: "" }]);
    assert.ok(r.ok);
    assert.equal(r.c.data.warehouse_id, null);
    assert.equal(r.c.lines[0].needed_date.toISOString().slice(0, 10), "2026-10-20");
  });
});

describe("the lifecycle (B8): Draft → Open → Ditutup, no approval", () => {
  test("a Draft is numbered PR/YYYY/MM/NNNN, in the base unit, and may be edited", async () => {
    const r = await create();
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.requestNo, /^PR\/2026\/10\/\d{4}$/);
    const row = await prisma.purRequestLine.findFirstOrThrow({ where: { request_id: r.id } });
    assert.equal(row.uom_id, f.pcs);
    const edited = await updatePurchaseRequest(r.id, header({ requester: "Gudang" }), [line(f.goods, 12), line(f.other, 5)], actor);
    assert.ok(edited.ok);
    assert.equal((await getPurchaseRequest(r.id))!.lines.length, 2);
    assert.ok(!(await updatePurchaseRequest(r.id, header({ item_type: "Jasa" }), [line(f.service, 1)], actor)).ok, "its kind cannot change");
  });

  test("Ajukan makes it Open and locks it; it is listed under its own kind only", async () => {
    const id = ids[0];
    assert.deepEqual(await transitionPurchaseRequest(id, "submit", actor), { ok: true });
    assert.equal((await getPurchaseRequest(id))!.status, "Open");
    assert.ok(!(await updatePurchaseRequest(id, header(), [line(f.goods, 1)], actor)).ok);
    assert.ok((await listPurchaseRequests("Barang")).some((r) => r.id === id));
    assert.ok(!(await listPurchaseRequests("Jasa")).some((r) => r.id === id));
  });

  test("Batalkan (Draft) and Tutup (Open) need a reason", async () => {
    const draft = await create();
    assert.ok(draft.ok);
    assert.deepEqual(await transitionPurchaseRequest(draft.id, "cancel", actor), { ok: false, errors: { reason: "Alasan wajib diisi." } });
    assert.deepEqual(await transitionPurchaseRequest(draft.id, "cancel", actor, "salah input"), { ok: true });
    assert.ok(!(await transitionPurchaseRequest(draft.id, "submit", actor)).ok, "a cancelled request is final");
  });

  test("a request closes itself once every line is fully ordered (for the Purchase Order)", async () => {
    const id = ids[0];
    const lines = await prisma.purRequestLine.findMany({ where: { request_id: id }, orderBy: { line_no: "asc" } });
    const closed = await prisma.$transaction((tx) => recordPurchaseRequestOrdered(tx, new Map([[lines[0].id, 12]]), actor));
    assert.deepEqual(closed, [], "one line still open");
    const done = await prisma.$transaction((tx) => recordPurchaseRequestOrdered(tx, new Map([[lines[1].id, 6]]), actor));
    const r = (await getPurchaseRequest(id))!;
    assert.equal(r.status, "Closed");
    assert.deepEqual(done, [r.requestNo]);
    assert.deepEqual(r.lines.map((l) => l.ordered), [12, 6], "ordering beyond a line is allowed (B15)");
  });

  test("Ajukan, Batalkan and Tutup are separate permissions", () => {
    assert.deepEqual(availablePurchaseRequestActions("Draft", purchaseRequestAbilities(["PURCHASE_REQUEST_SUBMIT"])), ["submit"]);
    assert.deepEqual(availablePurchaseRequestActions("Open", purchaseRequestAbilities(["PURCHASE_REQUEST_SUBMIT", "PURCHASE_REQUEST_CLOSE"])), ["close"]);
    assert.deepEqual(availablePurchaseRequestActions("Closed", purchaseRequestAbilities(["PURCHASE_REQUEST_CLOSE"])), []);
  });
});
