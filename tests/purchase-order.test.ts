import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  purchaseOrderOptions,
  transitionPurchaseOrder,
  updatePurchaseOrder,
  type PurchaseOrderHeaderInput,
  type PurchaseOrderLineInput,
} from "../src/lib/erp/purchase-order";
import { createPurchaseRequest, getPurchaseRequest, transitionPurchaseRequest } from "../src/lib/erp/purchase-request";
import { sharePurchaseOrderLine } from "../src/lib/erp/purchase-order-workflow";
import { FIXTURE_PREFIX, disconnect, partnerCategoryId, prisma, systemUserId } from "./helpers";

/**
 * The Purchase Order (P124, Purchasing-Concept.md B9–B16): one supplier, one
 * kind, lines only from Open requests, shared over them earliest need first,
 * the Customer Order's tax arithmetic, PPh doubled without an NPWP, approval,
 * and quantity given back to the requests on Tolak and Tutup.
 */

let actor = 0;
const f = {} as Record<string, number>;
const orders: number[] = [];
const requests: number[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

const header = (over: Partial<PurchaseOrderHeaderInput> = {}): PurchaseOrderHeaderInput => ({
  item_type: "Barang",
  order_date: "2026-10-06",
  supplier_id: f.pkp,
  term_id: f.term,
  delivery_date: "2026-10-15",
  warehouse_id: null,
  quotation_no: "",
  price_mode: "Exclude",
  is_taxable: true,
  note: "",
  ...over,
});
const line = (reqLines: number[], over: Partial<PurchaseOrderLineInput> = {}): PurchaseOrderLineInput => ({
  item_id: f.goods,
  uom_id: f.pcs,
  qty: 10,
  price: 1000,
  discount_type: null,
  discount_value: null,
  withholding_tax_id: null,
  note: "",
  request_line_ids: reqLines,
  ...over,
});

/** An Open request for the goods item: one line per (qty, needed date). */
async function openRequest(parts: [number, string][]) {
  const r = await createPurchaseRequest(
    { item_type: "Barang", request_date: "2026-10-01", needed_date: parts[0][1], requester: "", warehouse_id: null, note: "" },
    parts.map(([qty, d]) => ({ item_id: f.goods, qty, needed_date: d, note: "" })),
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  requests.push(r.id);
  await transitionPurchaseRequest(r.id, "submit", actor);
  const lines = await prisma.purRequestLine.findMany({ where: { request_id: r.id }, orderBy: { line_no: "asc" } });
  return { id: r.id, lines: lines.map((l) => l.id) };
}

async function create(h = header(), lines: PurchaseOrderLineInput[]) {
  const r = await createPurchaseOrder(h, lines, actor);
  if (r.ok) orders.push(r.id);
  return r;
}

before(async () => {
  actor = await systemUserId();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  f.box = (await prisma.refUom.create({ data: { uom_code: `test.${key("BOX")}`, uom_label: key("BOX"), uom_name: "Box", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BHN-BAKU" } })).id;
  f.goods = (
    await prisma.mItem.create({
      data: { item_code: `test.${key("G")}`, item_label: key("G"), item_name: "Bahan", item_type: "Barang", category_id: cat, base_uom_id: f.pcs, can_buy: true, can_sell: false, created_by: actor },
    })
  ).id;
  await prisma.mItemUom.create({ data: { item_id: f.goods, uom_id: f.box, factor: 12, created_by: actor } });
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.whtBuy = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("WB")}`, wht_label: key("WB"), wht_name: "PPh 23 Beli", rate: 2, usage: "Purchase", created_by: actor } })).id;
  f.whtSell = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("WS")}`, wht_label: key("WS"), wht_name: "PPh 23 Jual", rate: 2, usage: "Sales", created_by: actor } })).id;
  const supplierCat = await partnerCategoryId("Supplier");
  const supplier = async (l: string, pkp: boolean, taxId: string | null) =>
    (
      await prisma.mPartner.create({
        data: { partner_code: `test.${key(l)}`, partner_label: key(l), partner_name: l, category_id: supplierCat, is_pkp: pkp, tax_id: taxId, tax_id_type: taxId ? "NPWP" : null, created_by: actor },
      })
    ).id;
  f.pkp = await supplier("PKP", true, "0123456789012345");
  f.nonPkp = await supplier("NONPKP", false, null);
});

after(async () => {
  await prisma.purOrderLineRequest.deleteMany({ where: { order_line: { order_id: { in: orders } } } });
  await prisma.purOrderLine.deleteMany({ where: { order_id: { in: orders } } });
  await prisma.purOrder.deleteMany({ where: { id: { in: orders } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entity_key: "pur_order", row_id: { in: orders } }, { entity_key: "pur_request", row_id: { in: requests } }] } });
  await prisma.purRequestLine.deleteMany({ where: { request_id: { in: requests } } });
  await prisma.purRequest.deleteMany({ where: { id: { in: requests } } });
  await prisma.mPartner.deleteMany({ where: { id: { in: [f.pkp, f.nonPkp] } } });
  await prisma.refWithholdingTax.deleteMany({ where: { id: { in: [f.whtBuy, f.whtSell] } } });
  await prisma.refPaymentTerm.deleteMany({ where: { id: f.term } });
  await prisma.mItemUom.deleteMany({ where: { item_id: f.goods } });
  await prisma.mItem.deleteMany({ where: { id: f.goods } });
  await prisma.refUom.deleteMany({ where: { id: { in: [f.pcs, f.box] } } });
  await disconnect();
});

describe("sharing a line over its requests (B15)", () => {
  test("earliest need first; the rest beyond them belongs to no request", () => {
    const r = sharePurchaseOrderLine(130, [
      { id: 2, neededDate: "2026-11-01", left: 50 },
      { id: 1, neededDate: "2026-10-20", left: 60 },
    ]);
    assert.deepEqual([...r.shares], [[1, 60], [2, 50]]);
    assert.equal(r.excess, 20);
    const partial = sharePurchaseOrderLine(70, [
      { id: 1, neededDate: "2026-10-20", left: 60 },
      { id: 2, neededDate: "2026-11-01", left: 50 },
    ]);
    assert.deepEqual([...partial.shares], [[1, 60], [2, 10]]);
  });
});

describe("what a Purchase Order must satisfy", () => {
  test("the form offers Open request lines with something left", async () => {
    const pr = await openRequest([[100, "2026-10-20"]]);
    const o = await purchaseOrderOptions("Barang");
    const s = o.sources.find((x) => x.id === pr.lines[0]);
    assert.ok(s && s.qty === 100 && s.ordered === 0);
    assert.deepEqual(o.items.find((i) => i.id === f.goods)!.uoms.map((u) => u.factor), [1, 12], "base unit first, then conversions");
    assert.ok(!(await purchaseOrderOptions("Jasa")).sources.some((x) => x.id === pr.lines[0]));
  });

  test("a line comes from a request; a non-PKP supplier is not Kena PPN; a sales PPh is refused", async () => {
    const pr = await openRequest([[10, "2026-10-20"]]);
    const noReq = await checkPurchaseOrder(header(), [line([])]);
    assert.ok(!noReq.ok && /berasal dari Purchase Request/.test(noReq.errors["lines.0.item_id"]));
    const nonPkp = await checkPurchaseOrder(header({ supplier_id: f.nonPkp }), [line(pr.lines)]);
    assert.ok(!nonPkp.ok && /bukan PKP/.test(nonPkp.errors.is_taxable));
    const sell = await checkPurchaseOrder(header(), [line(pr.lines, { withholding_tax_id: f.whtSell })]);
    assert.ok(!sell.ok && /penjualan/.test(sell.errors["lines.0.withholding_tax_id"]));
    const twice = await checkPurchaseOrder(header(), [line(pr.lines), line(pr.lines)]);
    assert.ok(!twice.ok && /sudah dipakai/.test(twice.errors["lines.1.item_id"]));
  });

  test("another unit converts to base; PPh is doubled for a supplier without an NPWP (B12)", async () => {
    const pr = await openRequest([[24, "2026-10-20"]]);
    const box = await checkPurchaseOrder(header(), [line(pr.lines, { uom_id: f.box, qty: 2, price: 12000, withholding_tax_id: f.whtBuy })]);
    assert.ok(box.ok);
    assert.equal(box.lines[0].uom_factor, 12);
    assert.deepEqual([...box.lines[0].shares], [[pr.lines[0], 24]]);
    assert.equal(box.lines[0].withholding_rate, 2);
    const noNpwp = await checkPurchaseOrder(header({ supplier_id: f.nonPkp, is_taxable: false }), [line(pr.lines, { withholding_tax_id: f.whtBuy })]);
    assert.ok(noNpwp.ok);
    assert.equal(noNpwp.lines[0].withholding_rate, 4);
  });
});

describe("the lifecycle (B16)", () => {
  test("numbered PO/… or PO-NP/…; Ajukan writes the shares onto the requests, earliest first", async () => {
    const pr = await openRequest([
      [60, "2026-10-20"],
      [50, "2026-11-01"],
    ]);
    const np = await create(header({ is_taxable: false }), [line(pr.lines, { qty: 1 })]);
    assert.ok(np.ok && /^PO-NP\/2026\/10\/\d{4}$/.test(np.orderNo));
    await transitionPurchaseOrder(np.id, "cancel", actor, "uji");

    const r = await create(header(), [line(pr.lines, { qty: 130 })]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.orderNo, /^PO\/2026\/10\/\d{4}$/);
    assert.equal((await getPurchaseRequest(pr.id))!.lines[0].ordered, 0, "a Draft reserves nothing");
    assert.deepEqual(await transitionPurchaseOrder(r.id, "submit", actor), { ok: true });
    const req = (await getPurchaseRequest(pr.id))!;
    assert.deepEqual(req.lines.map((l) => l.ordered), [60, 50]);
    assert.equal(req.status, "Closed", "a request fully ordered closes itself");
    const view = (await getPurchaseOrder(r.id))!;
    assert.deepEqual(view.lines[0].shares.map((s) => s.baseQty), [60, 50]);
    assert.ok(!(await updatePurchaseOrder(r.id, header(), [line(pr.lines)], actor)).ok, "a submitted order is locked");

    // Tolak gives everything back and opens the request again.
    assert.deepEqual(await transitionPurchaseOrder(r.id, "reject", actor), { ok: false, errors: { reason: "Alasan wajib diisi." } });
    assert.deepEqual(await transitionPurchaseOrder(r.id, "reject", actor, "harga terlalu tinggi"), { ok: true });
    const back = (await getPurchaseRequest(pr.id))!;
    assert.deepEqual(back.lines.map((l) => l.ordered), [0, 0]);
    assert.equal(back.status, "Open");
  });

  test("Setujui makes it Open; Tutup gives back what was never received", async () => {
    const pr = await openRequest([[40, "2026-10-20"]]);
    const r = await create(header(), [line(pr.lines, { qty: 30 })]);
    assert.ok(r.ok);
    await transitionPurchaseOrder(r.id, "submit", actor);
    assert.deepEqual(await transitionPurchaseOrder(r.id, "approve", actor), { ok: true });
    assert.equal((await getPurchaseOrder(r.id))!.status, "Open");
    assert.equal((await getPurchaseRequest(pr.id))!.lines[0].ordered, 30);
    assert.deepEqual(await transitionPurchaseOrder(r.id, "close", actor, "supplier tidak sanggup"), { ok: true });
    assert.equal((await getPurchaseRequest(pr.id))!.lines[0].ordered, 0);
  });

  test("a request closed by hand refuses a Draft that still names it", async () => {
    const pr = await openRequest([[5, "2026-10-20"]]);
    const r = await create(header(), [line(pr.lines, { qty: 5 })]);
    assert.ok(r.ok);
    await transitionPurchaseRequest(pr.id, "close", actor, "tidak jadi");
    const s = await transitionPurchaseOrder(r.id, "submit", actor);
    assert.ok(!s.ok && /sudah tidak Open/.test(s.errors._form));
  });
});
