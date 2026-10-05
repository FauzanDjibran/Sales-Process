import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createCustomerOrder, transitionCustomerOrder, type CustomerOrderLineInput } from "../src/lib/erp/customer-order";
import { createSalesOrder, liveSalesOrderRefusal, transitionSalesOrder } from "../src/lib/erp/sales-order";
import {
  checkDeliveryOrder,
  createDeliveryOrder,
  deliveryOrderOptions,
  getDeliveryOrder,
  liveDeliveryOrderRefusal,
  salesOrderDeliveries,
  transitionDeliveryOrder,
  updateDeliveryOrder,
  type DeliveryOrderHeaderInput,
  type DeliveryOrderLineInput,
} from "../src/lib/erp/delivery-order";
import { availableDeliveryOrderActions, deliveryOrderAbilities } from "../src/lib/erp/delivery-order-workflow";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makePartner, prisma, systemUserId } from "./helpers";

/**
 * The Delivery Order (P93): the instruction to one warehouse to send goods of
 * one Customer Order, drawn line by line from that order's Open Sales Orders.
 * What may be saved, that the Delivery Orders on a Sales Order line never take
 * more than the line, how it moves Draft → Diterbitkan → Ditutup (or
 * Dibatalkan), and that a Sales Order cannot be closed while one is running. It
 * posts nothing, which the journal count proves.
 */

let actor = 0;
const f = {} as Record<string, number>;
const customerOrders: number[] = [];
const salesOrders: number[] = [];
const deliveryOrders: number[] = [];
const cleanups: (() => Promise<unknown>)[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

async function fixtureCustomer() {
  const id = await makePartner({ categoryLabel: "Customer" });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  await prisma.mPartner.update({
    where: { id },
    data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true },
  });
  await prisma.mPartnerAddress.createMany({
    data: [
      { partner_id: id, village_id: village.id, street: "Kantor", created_by: actor },
      { partner_id: id, village_id: village.id, street: "Gudang Customer", created_by: actor, sort_order: 1 },
    ],
  });
  return id;
}

const coLine = (item: number, qty: number): CustomerOrderLineInput => ({
  item_id: item,
  uom_id: f.pcs,
  qty,
  price: 1_000,
  discount_type: null,
  discount_value: null,
  withholding_tax_id: null,
  note: "",
});

/** An Open Customer Order of 10.000 GOODS and 500 OTHER. */
async function customerOrder(customer = f.customer) {
  const address = (await prisma.mPartnerAddress.findFirstOrThrow({ where: { partner_id: customer }, orderBy: { id: "asc" } })).id;
  const r = await createCustomerOrder(
    {
      order_date: "2026-09-10",
      customer_id: customer,
      address_id: address,
      term_id: f.term,
      price_mode: "Exclude",
      is_taxable: false,
      po_no: "PO-DO-1",
      po_date: "",
      salesperson: "",
      note: "",
    },
    [coLine(f.goods, 10_000), coLine(f.other, 500)],
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  customerOrders.push(r.id);
  assert.deepEqual(await transitionCustomerOrder(r.id, "submit", actor), { ok: true });
  assert.deepEqual(await transitionCustomerOrder(r.id, "approve", actor), { ok: true });
  const lines = await prisma.salCustomerOrderLine.findMany({ where: { order_id: r.id }, orderBy: { line_no: "asc" } });
  return { id: r.id, address, goodsLine: lines[0].id, otherLine: lines[1].id };
}

/** A Sales Order on `co` taken to `status`; returns its id and its line ids by CO line. */
async function salesOrder(
  co: Awaited<ReturnType<typeof customerOrder>>,
  qty: [number, number?],
  status: "Draft" | "PreSO" | "Open" = "Open"
) {
  const lines = [{ customer_order_line_id: co.goodsLine, qty: qty[0], note: "" }];
  if (qty[1]) lines.push({ customer_order_line_id: co.otherLine, qty: qty[1], note: "" });
  const r = await createSalesOrder(
    { customer_order_id: co.id, order_date: "2026-10-01", delivery_date: "2026-10-15", address_id: co.address, note: "" },
    lines,
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  salesOrders.push(r.id);
  if (status !== "Draft") {
    assert.deepEqual(await transitionSalesOrder(r.id, "submit", actor), { ok: true });
    assert.deepEqual(await transitionSalesOrder(r.id, "approve", actor), { ok: true });
  }
  if (status === "Open") assert.deepEqual(await transitionSalesOrder(r.id, "confirm", actor), { ok: true });
  const soLines = await prisma.salOrderLine.findMany({ where: { order_id: r.id }, orderBy: { line_no: "asc" } });
  return { id: r.id, goods: soLines[0].id, other: soLines[1]?.id ?? 0 };
}

let co = {} as Awaited<ReturnType<typeof customerOrder>>;
let so = {} as Awaited<ReturnType<typeof salesOrder>>;

const header = (over: Partial<DeliveryOrderHeaderInput> = {}): DeliveryOrderHeaderInput => ({
  customer_order_id: co.id,
  do_date: "2026-10-10",
  delivery_date: "2026-10-12",
  warehouse_id: f.warehouse,
  address_id: co.address,
  note: "",
  ...over,
});
const line = (qty: number | string, lineId = so.goods): DeliveryOrderLineInput => ({ sales_order_line_id: lineId, qty, note: "" });

async function create(h = header(), lines = [line(500)]) {
  const r = await createDeliveryOrder(h, lines, actor);
  if (r.ok) deliveryOrders.push(r.id);
  return r;
}

before(async () => {
  actor = await systemUserId();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const item = async (l: string) =>
    (
      await prisma.mItem.create({
        data: {
          item_code: `test.${key(l)}`,
          item_label: key(l),
          item_name: l,
          item_type: "Barang",
          category_id: cat,
          base_uom_id: f.pcs,
          can_sell: true,
          created_by: actor,
        },
      })
    ).id;
  f.goods = await item("GOODS");
  f.other = await item("OTHER");
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  const wh = (l: string, status: "Active" | "Inactive" = "Active") =>
    prisma.refWarehouse.create({
      data: { warehouse_code: `test.${key(l)}`, warehouse_label: key(l), warehouse_name: l, status, created_by: actor },
    });
  f.warehouse = (await wh("WH")).id;
  f.oldWarehouse = (await wh("OLD", "Inactive")).id;
  f.customer = await fixtureCustomer();
  f.stranger = await fixtureCustomer();
  f.strangerAddress = (await prisma.mPartnerAddress.findFirstOrThrow({ where: { partner_id: f.stranger } })).id;
  co = await customerOrder();
  so = await salesOrder(co, [2_000, 100]);

  cleanups.push(
    () => prisma.mItem.deleteMany({ where: { id: { in: [f.goods, f.other] } } }),
    () => prisma.refUom.deleteMany({ where: { id: f.pcs } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } }),
    () => prisma.refWarehouse.deleteMany({ where: { id: { in: [f.warehouse, f.oldWarehouse] } } })
  );
});

after(async () => {
  await prisma.salDeliveryOrderLine.deleteMany({ where: { delivery_order_id: { in: deliveryOrders } } });
  await prisma.salDeliveryOrder.deleteMany({ where: { id: { in: deliveryOrders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_delivery_order", row_id: { in: deliveryOrders } } });
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: salesOrders } } });
  await prisma.salOrder.deleteMany({ where: { id: { in: salesOrders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_order", row_id: { in: salesOrders } } });
  await prisma.salCustomerOrderLine.deleteMany({ where: { order_id: { in: customerOrders } } });
  await prisma.salCustomerOrder.deleteMany({ where: { id: { in: customerOrders } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "sal_customer_order", row_id: { in: customerOrders } } });
  await cleanupFixtures();
  for (const c of cleanups) await c();
  await disconnect();
});

// ----------------------------------------------------------------- options

describe("what the form offers", () => {
  test("Customer Orders with an Open Sales Order, its Open lines, and active warehouses", async () => {
    const quiet = await customerOrder();
    const draftOnly = await salesOrder(quiet, [10], "Draft");
    const o = await deliveryOrderOptions();
    const mine = o.orders.find((x) => x.id === co.id)!;
    assert.ok(mine, "the order with an Open Sales Order is offered");
    assert.ok(!o.orders.some((x) => x.id === quiet.id), "an order whose Sales Orders are not Open is not");
    assert.deepEqual(
      mine.lines.filter((l) => l.salesOrderId === so.id).map((l) => [l.qty, l.held]),
      [
        [2_000, 0],
        [100, 0],
      ]
    );
    assert.ok(!mine.lines.some((l) => l.salesOrderId === draftOnly.id));
    assert.equal(mine.addresses.length, 2);
    assert.ok(o.warehouses.some((w) => w.id === f.warehouse));
    assert.ok(!o.warehouses.some((w) => w.id === f.oldWarehouse), "an inactive warehouse is not offered");
  });
});

// -------------------------------------------------------------- validation

describe("what a Delivery Order must satisfy", () => {
  test("a Customer Order with an Open Sales Order, dates in order, an active warehouse", async () => {
    const quiet = await customerOrder();
    await salesOrder(quiet, [10], "PreSO");
    const noOpen = await checkDeliveryOrder(prisma, header({ customer_order_id: quiet.id }), [line(1)], null);
    assert.ok(!noOpen.ok && /belum punya Sales Order berstatus Open/.test(noOpen.errors.customer_order_id));
    const early = await checkDeliveryOrder(prisma, header({ do_date: "2026-09-01" }), [line(1)], null);
    assert.ok(!early.ok && /sebelum tanggal Customer Order/.test(early.errors.do_date));
    const back = await checkDeliveryOrder(prisma, header({ delivery_date: "2026-10-09" }), [line(1)], null);
    assert.ok(!back.ok && /sebelum tanggal DO/.test(back.errors.delivery_date));
    const noWh = await checkDeliveryOrder(prisma, header({ warehouse_id: null }), [line(1)], null);
    assert.ok(!noWh.ok && noWh.errors.warehouse_id);
    const oldWh = await checkDeliveryOrder(prisma, header({ warehouse_id: f.oldWarehouse }), [line(1)], null);
    assert.ok(!oldWh.ok && /nonaktif/.test(oldWh.errors.warehouse_id));
    const other = await checkDeliveryOrder(prisma, header({ address_id: f.strangerAddress }), [line(1)], null);
    assert.ok(!other.ok && /bukan milik customer/.test(other.errors.address_id));
  });

  test("lines: of this order's Open Sales Orders, once each, more than 0, within what is left", async () => {
    const strangerCo = await customerOrder(f.stranger);
    const strangerSo = await salesOrder(strangerCo, [10]);
    const foreign = await checkDeliveryOrder(prisma, header(), [line(1, strangerSo.goods)], null);
    assert.ok(!foreign.ok && /bukan bagian Sales Order/.test(foreign.errors["lines.0.sales_order_line_id"]));
    const preSo = await salesOrder(co, [10], "PreSO");
    const notOpen = await checkDeliveryOrder(prisma, header(), [line(1, preSo.goods)], null);
    assert.ok(!notOpen.ok && /bukan bagian Sales Order/.test(notOpen.errors["lines.0.sales_order_line_id"]), "a Pra-SO is not shipped from");
    const twice = await checkDeliveryOrder(prisma, header(), [line(1), line(2)], null);
    assert.ok(!twice.ok && /lebih dari sekali/.test(twice.errors["lines.1.sales_order_line_id"]));
    const zero = await checkDeliveryOrder(prisma, header(), [line("")], null);
    assert.ok(!zero.ok && zero.errors["lines.0.qty"], "a blank quantity is refused on its row");
    const tooMuch = await checkDeliveryOrder(prisma, header(), [line(2_000.0001)], null);
    assert.ok(!tooMuch.ok && /Melebihi sisa SO-NP\//.test(tooMuch.errors["lines.0.qty"]));
    const none = await checkDeliveryOrder(prisma, header(), [], null);
    assert.ok(!none.ok && none.errors._lines);
    assert.ok((await checkDeliveryOrder(prisma, header(), [line("2000"), line(100, so.other)], null)).ok, "exactly what is left");
  });
});

// ------------------------------------------------------------ the quantity

describe("Delivery Orders split a Sales Order", () => {
  test("each takes part of the line, numbered DO-NP/YYYY/MM/NNNN for an order without PPN (P109), and posts nothing", async () => {
    const journals = await prisma.accJournal.count();
    for (const m of ["10", "11"]) {
      const r = await create(header({ do_date: `2026-${m}-01`, delivery_date: `2026-${m}-02` }), [line(500)]);
      assert.ok(r.ok, JSON.stringify(r));
      assert.match(r.doNo, new RegExp(`^DO-NP/2026/${m}/\\d{4}$`));
    }
    assert.equal(await prisma.accJournal.count(), journals);
    const d = await salesOrderDeliveries(so.id, co.id);
    assert.equal(d.orders.length, 2);
    assert.deepEqual(d.lines.map((l) => l.held), [1_000, 0]);
  });

  test("one Delivery Order may ship from several Sales Orders of the order", async () => {
    const second = await salesOrder(co, [300]);
    const r = await create(header(), [line(100, so.other), line(300, second.goods)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual((await salesOrderDeliveries(second.id, co.id)).lines.map((l) => l.held), [300]);
  });

  test("the room left counts every Delivery Order but the one being saved", async () => {
    const third = await create(header(), [line(1_000)]);
    assert.ok(third.ok, JSON.stringify(third));
    const over = await create(header(), [line(1)]);
    assert.ok(!over.ok && /Melebihi sisa .*\(0/.test(over.errors["lines.0.qty"]), "nothing left");
    const kept = await updateDeliveryOrder(third.id, header({ note: "diubah" }), [line(1_000)], actor);
    assert.ok(kept.ok, JSON.stringify(kept));
    assert.equal((await getDeliveryOrder(third.id))!.header.note, "diubah");
  });

  test("a cancelled Delivery Order gives its quantity back", async () => {
    const third = deliveryOrders[deliveryOrders.length - 1];
    assert.deepEqual(await transitionDeliveryOrder(third, "cancel", actor), { ok: false, errors: { reason: "Alasan wajib diisi." } });
    assert.deepEqual(await transitionDeliveryOrder(third, "cancel", actor, "salah input"), { ok: true });
    assert.equal((await getDeliveryOrder(third))!.statusReason, "salah input");
    assert.deepEqual((await salesOrderDeliveries(so.id, co.id)).lines.map((l) => l.held), [1_000, 100]);
  });
});

// --------------------------------------------------------------- lifecycle

describe("Draft → Diterbitkan → Ditutup (P93)", () => {
  test("each step from its own status only; Terbitkan rechecks the room", async () => {
    const [first] = deliveryOrders;
    assert.ok(!(await transitionDeliveryOrder(first, "close", actor, "x")).ok, "a Draft is not closed");
    assert.deepEqual(await transitionDeliveryOrder(first, "issue", actor), { ok: true });
    assert.equal((await getDeliveryOrder(first))!.status, "Issued");
    assert.ok(!(await updateDeliveryOrder(first, header(), [line(10)], actor)).ok, "issued is locked");
    assert.ok(!(await transitionDeliveryOrder(first, "cancel", actor, "x")).ok, "only a Draft is cancelled");
    assert.deepEqual(await transitionDeliveryOrder(first, "close", actor, "dikirim sebagian"), { ok: true });
    // Closed by hand with nothing delivered, its 500 goes back to the Sales Order (U14).
    assert.deepEqual((await salesOrderDeliveries(so.id, co.id)).lines.map((l) => l.held), [500, 100], "a closed order releases what was not delivered");
  });

  test("Terbitkan is refused once the warehouse is deactivated", async () => {
    const r = await create(header(), [line(10)]);
    assert.ok(r.ok);
    await prisma.refWarehouse.update({ where: { id: f.warehouse }, data: { status: "Inactive" } });
    const refused = await transitionDeliveryOrder(r.id, "issue", actor);
    await prisma.refWarehouse.update({ where: { id: f.warehouse }, data: { status: "Active" } });
    assert.ok(!refused.ok && /Belum bisa diterbitkan: Gudang sudah nonaktif/.test(refused.errors._form));
    assert.deepEqual(await transitionDeliveryOrder(r.id, "cancel", actor, "uji"), { ok: true });
  });

  test("no approval step: Terbitkan, Batalkan and Tutup are separate permissions", () => {
    assert.deepEqual(availableDeliveryOrderActions("Draft", deliveryOrderAbilities(["DELIVERY_ORDER_ISSUE"])), ["issue"]);
    assert.deepEqual(
      availableDeliveryOrderActions("Draft", deliveryOrderAbilities(["DELIVERY_ORDER_ISSUE", "DELIVERY_ORDER_CANCEL"])),
      ["cancel", "issue"]
    );
    assert.deepEqual(availableDeliveryOrderActions("Issued", deliveryOrderAbilities(["DELIVERY_ORDER_CLOSE"])), ["close"]);
    assert.deepEqual(availableDeliveryOrderActions("Closed", deliveryOrderAbilities(["DELIVERY_ORDER_CLOSE"])), []);
  });
});

// --------------------------------------------------------- the Sales Order

describe("a Sales Order with a running Delivery Order is not closed", () => {
  test("Tutup is refused, then allowed once none is running", async () => {
    const running = await create(header(), [line(50)]);
    assert.ok(running.ok);
    const refused = await transitionSalesOrder(so.id, "close", actor, "selesai", liveDeliveryOrderRefusal);
    assert.ok(!refused.ok && new RegExp(running.doNo.replace(/\//g, "\\/")).test(refused.errors._form));
    assert.equal((await prisma.salOrder.findUniqueOrThrow({ where: { id: so.id } })).status, "Open");

    assert.deepEqual(await transitionDeliveryOrder(running.id, "issue", actor), { ok: true });
    assert.ok(!(await transitionSalesOrder(so.id, "close", actor, "selesai", liveDeliveryOrderRefusal)).ok, "an issued one still runs");
    assert.deepEqual(await transitionDeliveryOrder(running.id, "close", actor, "terkirim"), { ok: true });
    // The other Delivery Orders on this Sales Order stop running too.
    for (const id of deliveryOrders) {
      const d = await getDeliveryOrder(id);
      if (d?.status === "Draft") await transitionDeliveryOrder(id, "cancel", actor, "selesai");
      if (d?.status === "Issued") await transitionDeliveryOrder(id, "close", actor, "selesai");
    }
    assert.deepEqual(await transitionSalesOrder(so.id, "close", actor, "selesai", liveDeliveryOrderRefusal), { ok: true });

    const late = await create(header(), [line(1)]);
    assert.ok(!late.ok && /tidak lagi berstatus Open|bukan bagian/.test(late.errors["lines.0.sales_order_line_id"]), "a closed Sales Order takes no new Delivery Order");
    // The closed Sales Order still reads. Its Delivery Orders were closed with
    // nothing delivered (no Delivery Note here), so they hold nothing (U14).
    assert.deepEqual((await salesOrderDeliveries(so.id, co.id)).lines.map((l) => l.held), [0, 0]);
    // And the Customer Order closes once its Sales Orders do.
    for (const id of salesOrders) {
      const s = await prisma.salOrder.findUniqueOrThrow({ where: { id }, select: { status: true, customer_order_id: true } });
      if (s.customer_order_id !== co.id) continue;
      if (s.status === "Open" || s.status === "PreSO") await transitionSalesOrder(id, "close", actor, "selesai", liveDeliveryOrderRefusal);
      if (s.status === "Draft") await transitionSalesOrder(id, "cancel", actor, "selesai");
    }
    assert.deepEqual(await transitionCustomerOrder(co.id, "close", actor, "selesai", liveSalesOrderRefusal), { ok: true });
  });
});
