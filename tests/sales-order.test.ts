import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createCustomerOrder,
  transitionCustomerOrder,
  type CustomerOrderLineInput,
} from "../src/lib/erp/customer-order";
import {
  checkSalesOrder,
  createSalesOrder,
  customerOrderSchedule,
  getSalesOrder,
  liveSalesOrderRefusal,
  salesOrderOptions,
  transitionSalesOrder,
  updateSalesOrder,
  type SalesOrderHeaderInput,
  type SalesOrderLineInput,
} from "../src/lib/erp/sales-order";
import { availableSalesOrderActions, salesOrderAbilities } from "../src/lib/erp/sales-order-workflow";
import { FIXTURE_PREFIX, cleanupFixtures, disconnect, makePartner, prisma, systemUserId } from "./helpers";

/**
 * The Sales Order (P79): a dated part of an Open Customer Order. What may be
 * saved, that the Sales Orders on a Customer Order line never take more than
 * the line, how it moves Draft → Diajukan → Pra-SO → Open → Ditutup (or
 * Dibatalkan / Ditolak), and that a Customer Order cannot be closed while one
 * is running. It posts nothing, which the journal count proves.
 */

let actor = 0;
const f = {} as Record<string, number>;
const customerOrders: number[] = [];
const salesOrders: number[] = [];
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
      { partner_id: id, village_id: village.id, street: "Gudang", created_by: actor, sort_order: 1 },
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

/** A Customer Order of 10.000 GOODS and 500 OTHER, taken to `status`. */
async function customerOrder(status: "Draft" | "Open" = "Open", customer = f.customer) {
  const address = (await prisma.mPartnerAddress.findFirstOrThrow({ where: { partner_id: customer }, orderBy: { id: "asc" } })).id;
  const r = await createCustomerOrder(
    {
      order_date: "2026-09-10",
      customer_id: customer,
      address_id: address,
      term_id: f.term,
      price_mode: "Exclude",
      is_taxable: false,
      po_no: "PO-SO-1",
      po_date: "",
      salesperson: "",
      note: "",
    },
    [coLine(f.goods, 10_000), coLine(f.other, 500)],
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  customerOrders.push(r.id);
  if (status === "Open") {
    assert.deepEqual(await transitionCustomerOrder(r.id, "submit", actor), { ok: true });
    assert.deepEqual(await transitionCustomerOrder(r.id, "approve", actor), { ok: true });
  }
  const lines = await prisma.salCustomerOrderLine.findMany({ where: { order_id: r.id }, orderBy: { line_no: "asc" } });
  return { id: r.id, address, goodsLine: lines[0].id, otherLine: lines[1].id };
}

let co = {} as Awaited<ReturnType<typeof customerOrder>>;

const header = (over: Partial<SalesOrderHeaderInput> = {}): SalesOrderHeaderInput => ({
  customer_order_id: co.id,
  order_date: "2026-10-01",
  delivery_date: "2026-10-15",
  address_id: co.address,
  note: "",
  ...over,
});
const line = (qty: number | string, lineId = co.goodsLine): SalesOrderLineInput => ({
  customer_order_line_id: lineId,
  qty,
  note: "",
});

async function create(h = header(), lines = [line(2_000)]) {
  const r = await createSalesOrder(h, lines, actor);
  if (r.ok) salesOrders.push(r.id);
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
  f.customer = await fixtureCustomer();
  f.stranger = await fixtureCustomer();
  f.strangerAddress = (await prisma.mPartnerAddress.findFirstOrThrow({ where: { partner_id: f.stranger } })).id;
  co = await customerOrder();

  cleanups.push(
    () => prisma.mItem.deleteMany({ where: { id: { in: [f.goods, f.other] } } }),
    () => prisma.refUom.deleteMany({ where: { id: f.pcs } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } })
  );
});

after(async () => {
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
  test("Open Customer Orders, with their lines and the customer's addresses", async () => {
    const draft = await customerOrder("Draft");
    const o = await salesOrderOptions();
    const mine = o.orders.find((x) => x.id === co.id)!;
    assert.ok(mine, "the Open order is offered");
    assert.ok(!o.orders.some((x) => x.id === draft.id), "a Draft is not");
    assert.deepEqual(mine.lines.map((l) => [l.qty, l.held]), [[10_000, 0], [500, 0]]);
    assert.equal(mine.addresses.length, 2);
    assert.equal(mine.addressId, co.address);
  });
});

// -------------------------------------------------------------- validation

describe("what a Sales Order must satisfy", () => {
  test("an Open Customer Order, and dates in order", async () => {
    const draft = await customerOrder("Draft");
    const notOpen = await checkSalesOrder(prisma, header({ customer_order_id: draft.id }), [line(1, draft.goodsLine)], null);
    assert.ok(!notOpen.ok && /harus berstatus Open/.test(notOpen.errors.customer_order_id));
    const early = await checkSalesOrder(prisma, header({ order_date: "2026-09-01" }), [line(1)], null);
    assert.ok(!early.ok && /sebelum tanggal Customer Order/.test(early.errors.order_date));
    const back = await checkSalesOrder(prisma, header({ delivery_date: "2026-09-30" }), [line(1)], null);
    assert.ok(!back.ok && /sebelum tanggal SO/.test(back.errors.delivery_date));
    const noDate = await checkSalesOrder(prisma, header({ delivery_date: "" }), [line(1)], null);
    assert.ok(!noDate.ok && noDate.errors.delivery_date);
  });

  test("the address is one of the customer's — any of them", async () => {
    const other = await checkSalesOrder(prisma, header({ address_id: f.strangerAddress }), [line(1)], null);
    assert.ok(!other.ok && /bukan milik customer/.test(other.errors.address_id));
    const second = (await prisma.mPartnerAddress.findMany({ where: { partner_id: f.customer }, orderBy: { id: "asc" } }))[1].id;
    assert.ok((await checkSalesOrder(prisma, header({ address_id: second }), [line(1)], null)).ok);
  });

  test("lines: of this Customer Order, once each, more than 0, within what is left", async () => {
    const strangerCo = await customerOrder("Open", f.stranger);
    const foreign = await checkSalesOrder(prisma, header(), [line(1, strangerCo.goodsLine)], null);
    assert.ok(!foreign.ok && /bukan bagian Customer Order ini/.test(foreign.errors["lines.0.customer_order_line_id"]));
    const twice = await checkSalesOrder(prisma, header(), [line(1), line(2)], null);
    assert.ok(!twice.ok && /lebih dari sekali/.test(twice.errors["lines.1.customer_order_line_id"]));
    const zero = await checkSalesOrder(prisma, header(), [line(0)], null);
    assert.ok(!zero.ok && zero.errors["lines.0.qty"]);
    const tooMuch = await checkSalesOrder(prisma, header(), [line(10_000.0001)], null);
    assert.ok(!tooMuch.ok && /Melebihi sisa Customer Order/.test(tooMuch.errors["lines.0.qty"]));
    const none = await checkSalesOrder(prisma, header(), [], null);
    assert.ok(!none.ok && none.errors._lines);
    assert.ok((await checkSalesOrder(prisma, header(), [line("10000")], null)).ok, "exactly what is left");
  });
});

// ----------------------------------------------------------- the schedule

describe("Sales Orders split a Customer Order (10.000 as 2.000 a month)", () => {
  test("each takes part of the line, numbered SO/YYYY/MM/NNNN, and posts nothing", async () => {
    const journals = await prisma.accJournal.count();
    for (const [m, d] of [["10", "15"], ["11", "15"]]) {
      const r = await create(header({ order_date: `2026-${m}-01`, delivery_date: `2026-${m}-${d}` }), [line(2_000)]);
      assert.ok(r.ok, JSON.stringify(r));
      assert.match(r.orderNo, new RegExp(`^SO/2026/${m}/\\d{4}$`));
    }
    assert.equal(await prisma.accJournal.count(), journals);
    const s = await customerOrderSchedule(co.id);
    assert.equal(s.orders.length, 2);
    assert.deepEqual(s.lines.map((l) => l.held), [4_000, 0]);
  });

  test("the room left counts every Sales Order but the one being saved", async () => {
    const third = await create(header(), [line(6_000), line(500, co.otherLine)]);
    assert.ok(third.ok, JSON.stringify(third));
    const over = await create(header(), [line(1)]);
    assert.ok(!over.ok && /Melebihi sisa Customer Order \(0/.test(over.errors["lines.0.qty"]), "nothing left");
    // Editing the third may keep its own 6.000 — it does not count against itself.
    const kept = await updateSalesOrder(third.id, header({ note: "diubah" }), [line(6_000)], actor);
    assert.ok(kept.ok, JSON.stringify(kept));
    assert.deepEqual((await getSalesOrder(third.id))!.lines.map((l) => Number(l.qty)), [6_000]);
  });

  test("a cancelled or rejected Sales Order gives its quantity back", async () => {
    const [, , third] = salesOrders;
    assert.deepEqual(await transitionSalesOrder(third, "cancel", actor, "salah input"), { ok: true });
    assert.deepEqual((await customerOrderSchedule(co.id)).lines.map((l) => l.held), [4_000, 0]);
    const again = await create(header(), [line(6_000)]);
    assert.ok(again.ok, "the 6.000 is free again");
    assert.deepEqual(await transitionSalesOrder(again.id, "submit", actor), { ok: true });
    assert.deepEqual(await transitionSalesOrder(again.id, "reject", actor, "jadwal berubah"), { ok: true });
    assert.equal((await getSalesOrder(again.id))!.statusReason, "jadwal berubah");
    assert.deepEqual((await customerOrderSchedule(co.id)).lines.map((l) => l.held), [4_000, 0]);
  });
});

// --------------------------------------------------------------- lifecycle

describe("Draft → Diajukan → Pra-SO → Open → Ditutup (P79)", () => {
  test("each step from its own status only", async () => {
    const [first] = salesOrders;
    assert.ok(!(await transitionSalesOrder(first, "approve", actor)).ok, "a Draft is not approved");
    assert.deepEqual(await transitionSalesOrder(first, "submit", actor), { ok: true });
    assert.ok(!(await updateSalesOrder(first, header(), [line(1_000)], actor)).ok, "submitted is locked");
    assert.ok(!(await transitionSalesOrder(first, "cancel", actor, "x")).ok, "only a Draft is cancelled");
    assert.ok(!(await transitionSalesOrder(first, "confirm", actor)).ok, "not before Pra-SO");
    assert.deepEqual(await transitionSalesOrder(first, "approve", actor), { ok: true });
    assert.equal((await getSalesOrder(first))!.status, "PreSO");
    assert.deepEqual(await transitionSalesOrder(first, "confirm", actor), { ok: true });
    assert.equal((await getSalesOrder(first))!.status, "Open");
    assert.deepEqual(await transitionSalesOrder(first, "close", actor), { ok: false, errors: { reason: "Alasan wajib diisi." } });
    assert.deepEqual(await transitionSalesOrder(first, "close", actor, "terkirim"), { ok: true });
    // Closed by hand with nothing delivered, it holds only what was delivered —
    // none — and its 2.000 goes back to the Customer Order (U14).
    assert.deepEqual((await customerOrderSchedule(co.id)).lines.map((l) => l.held), [2_000, 0], "a closed order releases what was not delivered");
  });

  test("a Pra-SO may be closed without being confirmed", async () => {
    const [, second] = salesOrders;
    await transitionSalesOrder(second, "submit", actor);
    await transitionSalesOrder(second, "approve", actor);
    assert.deepEqual(await transitionSalesOrder(second, "close", actor, "dibatalkan customer"), { ok: true });
  });

  test("Setujui carries Tolak; Konfirmasi is its own permission", () => {
    const approver = salesOrderAbilities(["SALES_ORDER_APPROVE"]);
    assert.deepEqual(availableSalesOrderActions("Submitted", approver), ["reject", "approve"]);
    assert.deepEqual(availableSalesOrderActions("PreSO", approver), []);
    assert.deepEqual(availableSalesOrderActions("PreSO", salesOrderAbilities(["SALES_ORDER_CONFIRM", "SALES_ORDER_CLOSE"])), ["close", "confirm"]);
  });
});

// ------------------------------------------------------ the Customer Order

describe("a Customer Order with a running Sales Order is not closed", () => {
  test("Tutup Pesanan is refused, then allowed once none is running", async () => {
    const running = await create(header(), [line(100)]);
    assert.ok(running.ok);
    const refused = await transitionCustomerOrder(co.id, "close", actor, "selesai", liveSalesOrderRefusal);
    assert.ok(!refused.ok && new RegExp(running.orderNo.replace(/\//g, "\\/")).test(refused.errors._form));
    assert.equal((await prisma.salCustomerOrder.findUniqueOrThrow({ where: { id: co.id } })).status, "Open");

    assert.deepEqual(await transitionSalesOrder(running.id, "cancel", actor, "tidak jadi"), { ok: true });
    assert.deepEqual(await transitionCustomerOrder(co.id, "close", actor, "selesai", liveSalesOrderRefusal), { ok: true });
    const late = await create(header(), [line(1)]);
    assert.ok(!late.ok && /harus berstatus Open/.test(late.errors.customer_order_id), "a closed order takes no new Sales Order");
  });
});
