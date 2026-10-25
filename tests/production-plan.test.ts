import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createCustomerOrder, transitionCustomerOrder } from "../src/lib/erp/customer-order";
import { createSalesOrder, transitionSalesOrder } from "../src/lib/erp/sales-order";
import {
  createProductionPlan,
  getProductionPlan,
  planLineChoices,
  planLineIdsOfPlan,
  productionPlanOptions,
  transitionProductionPlan,
  updateProductionPlan,
  type PlanHeaderInput,
  type PlanLineInput,
} from "../src/lib/erp/production-plan";
import { availableProductionPlanActions, productionPlanAbilities } from "../src/lib/erp/production-plan-workflow";
import { createProductionOrder, openOrdersOfPlanRefusal, ordersOfPlanLines, planMaterials, productionOrderOptions, releasedByPlanLines, transitionProductionOrder } from "../src/lib/erp/production-order";
import { FIXTURE_PREFIX, cleanupFixtures, cleanupStock, disconnect, makePartner, openFiscalYear, cleanupFiscalYear, prisma, productionCostCenterId, stockIn, systemUserId } from "./helpers";

/**
 * The Rencana Produksi (P168): PPIC's plan of one month, covering Open Sales
 * Order lines, from which Perintah Produksi are released. What may be saved; that
 * a Draft reserves nothing while Ajukan reserves under the Sales Order lines'
 * lock, so two plans never cover one quantity twice; that Tolak and Tutup give it
 * back; that a Perintah is made only from an approved plan's line, may exceed it
 * and blocks the plan's Tutup while Draft or Open. It posts nothing.
 */

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
let actor = 0;
const f = {} as Record<string, number>;
const customerOrders: number[] = [];
const salesOrders: number[] = [];
const plans: number[] = [];
const orders: number[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;
const items: number[] = [];

const header = (over: Partial<PlanHeaderInput> = {}): PlanHeaderInput => ({ plan_date: today, period: month, note: "", ...over });
const line = (item: number, qty: number, demands: { so_line_id: number; qty: number }[] = [], start = `${month}-10`): PlanLineInput => ({ item_id: item, qty, start_date: start, note: "", demands });

async function create(h = header(), lines: PlanLineInput[]) {
  const r = await createProductionPlan(h, lines, actor);
  if (r.ok) plans.push(r.id);
  return r;
}

/** An Open Customer Order and Sales Order of `qty` of the item; the Sales Order line id. */
async function soLine(item: number, qty: number, status: "PreSO" | "Open" = "Open") {
  const address = (await prisma.mPartnerAddress.findFirstOrThrow({ where: { partner_id: f.customer }, orderBy: { id: "asc" } })).id;
  const co = await createCustomerOrder(
    { order_date: "2026-09-10", customer_id: f.customer, address_id: address, term_id: f.term, price_mode: "Exclude", is_taxable: false, po_no: "PO-PLAN", po_date: "", salesperson: "", note: "" },
    [{ item_id: item, uom_id: f.g, qty: 10_000, price: 1_000, discount_type: null, discount_value: null, withholding_tax_id: null, note: "" }],
    actor
  );
  assert.ok(co.ok, JSON.stringify(co));
  customerOrders.push(co.id);
  assert.deepEqual(await transitionCustomerOrder(co.id, "submit", actor), { ok: true });
  assert.deepEqual(await transitionCustomerOrder(co.id, "approve", actor), { ok: true });
  const coLine = await prisma.salCustomerOrderLine.findFirstOrThrow({ where: { order_id: co.id } });
  const so = await createSalesOrder(
    { customer_order_id: co.id, order_date: "2026-10-01", delivery_date: "2026-10-15", address_id: address, note: "" },
    [{ customer_order_line_id: coLine.id, qty, note: "" }],
    actor
  );
  assert.ok(so.ok, JSON.stringify(so));
  salesOrders.push(so.id);
  assert.deepEqual(await transitionSalesOrder(so.id, "submit", actor), { ok: true });
  assert.deepEqual(await transitionSalesOrder(so.id, "approve", actor), { ok: true });
  if (status === "Open") assert.deepEqual(await transitionSalesOrder(so.id, "confirm", actor), { ok: true });
  return (await prisma.salOrderLine.findFirstOrThrow({ where: { order_id: so.id } })).id;
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.g = (await prisma.refUom.create({ data: { uom_code: `test.${key("G")}`, uom_label: key("G"), uom_name: "Gram", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const item = async (l: string, track = true) => {
    const id = (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: cat, base_uom_id: f.g, can_sell: true, track_stock: track, created_by: actor },
      })
    ).id;
    items.push(id);
    return id;
  };
  f.fg = await item("FG");
  f.other = await item("OTHER");
  f.plain = await item("PLAIN", false);
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang", created_by: actor } })).id;
  f.ws = (await prisma.refWorkstation.create({ data: { workstation_code: `test.${key("WS")}`, workstation_label: key("WS"), workstation_name: "Station", cost_center_id: await productionCostCenterId(), created_by: actor } })).id;
  f.customer = await makePartner({ categoryLabel: "Customer" });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  await prisma.mPartner.update({ where: { id: f.customer }, data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true } });
  await prisma.mPartnerAddress.create({ data: { partner_id: f.customer, village_id: village.id, street: "Kantor", created_by: actor } });
  f.open = await soLine(f.fg, 1_000);
  f.pre = await soLine(f.fg, 500, "PreSO");
  f.otherLine = await soLine(f.other, 300);
  f.stock = await stockIn(f.fg, f.warehouse, key("S1"), 150, 1500);
});

after(async () => {
  await prisma.prdOrderRequirement.deleteMany({ where: { order_id: { in: orders } } });
  await prisma.prdOrderStep.deleteMany({ where: { order_id: { in: orders } } });
  await prisma.prdOrder.deleteMany({ where: { id: { in: orders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_order", row_id: { in: orders } } });
  await prisma.prdPlanLineDemand.deleteMany({ where: { plan_line: { plan_id: { in: plans } } } });
  await prisma.prdPlanLine.deleteMany({ where: { plan_id: { in: plans } } });
  await prisma.prdPlan.deleteMany({ where: { id: { in: plans } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "prd_plan", row_id: { in: plans } } });
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: salesOrders } } });
  await prisma.salOrder.deleteMany({ where: { id: { in: salesOrders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_order", row_id: { in: salesOrders } } });
  await prisma.salCustomerOrderLine.deleteMany({ where: { order_id: { in: customerOrders } } });
  await prisma.salCustomerOrder.deleteMany({ where: { id: { in: customerOrders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_customer_order", row_id: { in: customerOrders } } });
  await cleanupFixtures();
  await cleanupStock(items);
  await prisma.mItem.deleteMany({ where: { id: { in: items } } });
  await prisma.refWorkstation.deleteMany({ where: { id: f.ws } });
  await prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } });
  await prisma.refPaymentTerm.deleteMany({ where: { id: f.term } });
  await prisma.refUom.deleteMany({ where: { id: f.g } });
  await cleanupFiscalYear();
  await disconnect();
});

describe("what the form offers", () => {
  test("Barang with Kelola Stok, the Open and Pra-SO lines with what each has left, and the stock on hand", async () => {
    const o = await productionPlanOptions();
    assert.ok(o.items.some((i) => i.id === f.fg));
    assert.ok(!o.items.some((i) => i.id === f.plain), "an item without Kelola Stok is never made");
    const open = o.demands.find((d) => d.id === f.open)!;
    assert.deepEqual([open.status, open.qty, open.delivered, open.reserved], ["Open", 1000, 0, 0]);
    assert.equal(o.demands.find((d) => d.id === f.pre)!.status, "PreSO", "a Pra-SO is listed so the form can say why it cannot be picked");
    assert.equal(o.stock[f.fg], 150);
  });
});

describe("what a plan may be saved with", () => {
  test("a month, a date and a line; the start inside the month; an item once per start date", async () => {
    const empty = await create(header({ period: "" }), []);
    assert.ok(!empty.ok && empty.errors.period && empty.errors._lines);
    const outside = await create(header(), [line(f.fg, 10, [], "1999-01-05")]);
    assert.ok(!outside.ok && /di dalam bulan/.test(outside.errors["lines.0.start_date"]));
    const twice = await create(header(), [line(f.fg, 10), line(f.fg, 20)]);
    assert.ok(!twice.ok && /sudah ada/.test(twice.errors["lines.1.item_id"]));
    const plain = await create(header(), [line(f.plain, 10)]);
    assert.ok(!plain.ok && /Kelola Stok/.test(plain.errors["lines.0.item_id"]));
    const noQty = await create(header(), [line(f.fg, 0)]);
    assert.ok(!noQty.ok && noQty.errors["lines.0.qty"]);
  });

  test("a Sales Order line must be Open, of the line's item, once, and within what is left", async () => {
    const pre = await create(header(), [line(f.fg, 10, [{ so_line_id: f.pre, qty: 10 }])]);
    assert.ok(!pre.ok && /Pra-SO/.test(pre.errors["lines.0.demands.0.qty"]));
    const wrongItem = await create(header(), [line(f.fg, 10, [{ so_line_id: f.otherLine, qty: 10 }])]);
    assert.ok(!wrongItem.ok && wrongItem.errors["lines.0.demands.0.qty"]);
    const over = await create(header(), [line(f.fg, 2000, [{ so_line_id: f.open, qty: 1001 }])]);
    assert.ok(!over.ok && /Melebihi sisa/.test(over.errors["lines.0.demands.0.qty"]));
    const twice = await create(header(), [line(f.fg, 20, [{ so_line_id: f.open, qty: 10 }, { so_line_id: f.open, qty: 10 }])]);
    assert.ok(!twice.ok && /lebih dari sekali/.test(twice.errors["lines.0.demands.1.qty"]));
  });

  test("a plan with a stock build line and a covered line is saved, numbered RP/YYYY/MM/NNNN, and posts nothing", async () => {
    const journals = await prisma.accJournal.count();
    const r = await create(header(), [line(f.fg, 850, [{ so_line_id: f.open, qty: 1000 }], `${month}-05`), line(f.other, 40, [], `${month}-12`)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.planNo, /^RP\/\d{4}\/\d{2}\/\d{4}$/);
    f.p1 = r.id;
    assert.equal(await prisma.accJournal.count(), journals);
    const v = (await getProductionPlan(f.p1))!;
    assert.equal(v.status, "Draft");
    assert.equal(v.lines[0].demands.length, 1);
    assert.equal(v.lines[1].demands.length, 0, "a stock build covers no Sales Order");
  });

  test("a Draft reserves nothing: a second plan may cover the same quantity", async () => {
    const r = await create(header(), [line(f.fg, 100, [{ so_line_id: f.open, qty: 1000 }])]);
    assert.ok(r.ok, JSON.stringify(r));
    f.p2 = r.id;
  });
});

describe("Ajukan reserves under the Sales Order lines' lock; Tolak and Tutup give it back", () => {
  test("the first plan reserves; the second is refused naming the room; a Draft's own options show the reservation", async () => {
    assert.ok((await transitionProductionPlan(f.p1, "submit", actor)).ok);
    const o = await productionPlanOptions(null, f.p2);
    assert.equal(o.demands.find((d) => d.id === f.open)!.reserved, 1000);
    const second = await transitionProductionPlan(f.p2, "submit", actor);
    assert.ok(!second.ok && /Belum bisa diajukan.*Melebihi sisa/.test(second.errors._form), JSON.stringify(second));
    const own = await productionPlanOptions(null, f.p1);
    assert.equal(own.demands.find((d) => d.id === f.open)!.reserved, 0, "a plan's own demand is not counted against it");
  });

  test("Tolak frees the quantity, so the second plan can now be submitted", async () => {
    assert.ok(!(await transitionProductionPlan(f.p1, "reject", actor, "")).ok);
    assert.ok((await transitionProductionPlan(f.p1, "reject", actor, "belum waktunya")).ok);
    assert.equal((await getProductionPlan(f.p1))!.status, "Rejected");
    assert.ok((await transitionProductionPlan(f.p2, "submit", actor)).ok);
    assert.ok(!(await updateProductionPlan(f.p2, header(), [line(f.fg, 1)], actor)).ok, "a submitted plan is locked");
    assert.ok((await transitionProductionPlan(f.p2, "approve", actor)).ok);
    assert.equal((await getProductionPlan(f.p2))!.status, "Open");
  });
});

describe("a Perintah is released from an approved plan's line", () => {
  const orderHeader = (lineId: number | null, over = {}) => ({ order_date: today, target_item_id: f.fg, target_qty: 60, routing_id: null, note: "", plan_line_id: lineId, ...over });
  const steps = () => [{ workstation_id: f.ws }];

  test("only a line of an Open plan, and for the same item", async () => {
    const [lineId] = await planLineIdsOfPlan(f.p2);
    f.line = lineId;
    assert.ok((await planLineChoices()).some((l) => l.id === lineId));
    const wrong = await createProductionOrder(orderHeader(lineId, { target_item_id: f.other }), steps(), actor);
    assert.ok(!wrong.ok && /barang lain/.test(wrong.errors.plan_line_id));
    const none = await createProductionOrder(orderHeader(999_999_999), steps(), actor);
    assert.ok(!none.ok && none.errors.plan_line_id);
    const loose = await createProductionOrder(orderHeader(null), steps(), actor);
    assert.ok(loose.ok, "outside the plan stays allowed");
    orders.push(loose.id);
  });

  test("it may exceed the plan line; Dirilis adds the live Perintah and a cancelled one frees it", async () => {
    const a = await createProductionOrder(orderHeader(f.line), steps(), actor);
    assert.ok(a.ok, JSON.stringify(a));
    orders.push(a.id);
    const b = await createProductionOrder(orderHeader(f.line, { target_qty: 90 }), steps(), actor);
    assert.ok(b.ok, "100 planned, 150 released: a warning for the plan, never a refusal");
    orders.push(b.id);
    assert.equal((await releasedByPlanLines([f.line])).get(f.line), 150);
    assert.deepEqual((await ordersOfPlanLines([f.line])).map((o) => o.orderNo).length, 2);
    assert.ok((await transitionProductionOrder(b.id, "cancel", actor, "salah")).ok);
    assert.equal((await releasedByPlanLines([f.line])).get(f.line), 60);
    const o = await productionOrderOptions(null);
    assert.equal(o.released[f.line], 60);
  });

  test("the plan cannot be closed while a Perintah from it is Draft or Open; then it can", async () => {
    const refusal = await openOrdersOfPlanRefusal([f.line]);
    assert.match(refusal ?? "", /masih ada Perintah Produksi/);
    const refused = await transitionProductionPlan(f.p2, "close", actor, "selesai", () => openOrdersOfPlanRefusal([f.line]));
    assert.ok(!refused.ok && /belum bisa ditutup/.test(refused.errors._form));
    const [live] = await ordersOfPlanLines([f.line]);
    assert.ok((await transitionProductionOrder(live.id, "cancel", actor, "tidak jadi")).ok);
    assert.equal(await openOrdersOfPlanRefusal([f.line]), null);
    assert.ok((await transitionProductionPlan(f.p2, "close", actor, "selesai", () => openOrdersOfPlanRefusal([f.line]))).ok);
    assert.ok(!(await planLineChoices()).some((l) => l.id === f.line && l.open), "a closed plan offers no line");
    const late = await createProductionOrder(orderHeader(f.line), steps(), actor);
    assert.ok(!late.ok && /tidak lagi Disetujui/.test(late.errors.plan_line_id));
  });

  test("the material view is empty for items with no default Routing and BoM", async () => {
    assert.deepEqual(await planMaterials([{ itemId: f.fg, qty: 100 }]), []);
  });
});

describe("what the user may do", () => {
  test("Draft offers Ajukan and Batalkan; a submitted plan Setujui and Tolak; an approved one Tutup", () => {
    const can = productionPlanAbilities(["PRODUCTION_PLAN_SUBMIT", "PRODUCTION_PLAN_APPROVE", "PRODUCTION_PLAN_CANCEL", "PRODUCTION_PLAN_CLOSE"]);
    assert.deepEqual(availableProductionPlanActions("Draft", can).sort(), ["cancel", "submit"]);
    assert.deepEqual(availableProductionPlanActions("Submitted", can).sort(), ["approve", "reject"]);
    assert.deepEqual(availableProductionPlanActions("Open", can), ["close"]);
    assert.deepEqual(availableProductionPlanActions("Closed", can), []);
  });
});
