import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createCustomerOrder, transitionCustomerOrder } from "../src/lib/erp/customer-order";
import { createSalesOrder, liveSalesOrderRefusal, transitionSalesOrder } from "../src/lib/erp/sales-order";
import { createDeliveryOrder, liveDeliveryOrderRefusal, salesOrderDeliveries, transitionDeliveryOrder } from "../src/lib/erp/delivery-order";
import {
  checkDeliveryNote,
  createDeliveryNote,
  deliveryNoteOptions,
  deliveryNotePreview,
  deliveryOrderNotes,
  getDeliveryNote,
  liveDeliveryNoteRefusal,
  transitionDeliveryNote,
  updateDeliveryNote,
  type DeliveryNoteHeaderInput,
  type DeliveryNoteLineInput,
} from "../src/lib/erp/delivery-note";
import { setItemCost } from "../src/lib/erp/inventory";
import { availableDeliveryNoteActions, deliveryNoteAbilities } from "../src/lib/erp/delivery-note-workflow";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  disconnect,
  makeAccount,
  makePartner,
  openFiscalYear,
  prisma,
  systemUserId,
} from "./helpers";

/**
 * The Delivery Note (C28, U11–U14): the document the goods leave on, made from
 * one issued Delivery Order. What may be saved; that the notes on a Delivery
 * Order line never take more than the line; that Posting issues the goods
 * through the stand-in inventory and writes Dr HPP / Cr Persediaan at the
 * Harga Pokok, cost of goods only; that it records what left on the Delivery
 * Order and Sales Order, which close themselves once fully delivered; and that
 * closing either by hand releases only what never left.
 */

const today = new Date().toISOString().slice(0, 10);
let actor = 0;
const f = {} as Record<string, number>;
const ids = { co: [] as number[], so: [] as number[], do: [] as number[], dn: [] as number[] };
const cleanups: (() => Promise<unknown>)[] = [];
const savedSettings = new Map<string, string | null>();
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

async function setMapping(k: string, v: string | null) {
  if (!savedSettings.has(k)) {
    savedSettings.set(k, (await prisma.sysSetting.findUnique({ where: { setting_key: k } }))?.setting_value ?? null);
  }
  await prisma.sysSetting.upsert({ where: { setting_key: k }, update: { setting_value: v }, create: { setting_key: k, setting_value: v, updated_by: actor } });
}

async function fixtureCustomer() {
  const id = await makePartner({ categoryLabel: "Customer" });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  await prisma.mPartner.update({
    where: { id },
    data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true },
  });
  await prisma.mPartnerAddress.create({ data: { partner_id: id, village_id: village.id, street: "Kantor", created_by: actor } });
  return id;
}

/**
 * An Open Customer Order — 100 BOX of GOODS (1 BOX = 12 PCS) and 50 PCS of
 * OTHER — one Open Sales Order for all of it, and one issued Delivery Order
 * for all of that. Returns the Delivery Order and its line ids.
 */
async function issuedDeliveryOrder() {
  const address = (await prisma.mPartnerAddress.findFirstOrThrow({ where: { partner_id: f.customer } })).id;
  const line = (item: number, uom: number, qty: number) => ({
    item_id: item,
    uom_id: uom,
    qty,
    price: 1_000,
    discount_type: null,
    discount_value: null,
    withholding_tax_id: null,
    note: "",
  });
  const co = await createCustomerOrder(
    {
      order_date: today,
      customer_id: f.customer,
      address_id: address,
      term_id: f.term,
      price_mode: "Exclude",
      is_taxable: false,
      po_no: "",
      po_date: "",
      salesperson: "",
      note: "",
    },
    [line(f.goods, f.box, 100), line(f.other, f.pcs, 50)],
    actor
  );
  assert.ok(co.ok, JSON.stringify(co));
  ids.co.push(co.id);
  await transitionCustomerOrder(co.id, "submit", actor);
  await transitionCustomerOrder(co.id, "approve", actor);
  const coLines = await prisma.salCustomerOrderLine.findMany({ where: { order_id: co.id }, orderBy: { line_no: "asc" } });

  const so = await createSalesOrder(
    { customer_order_id: co.id, order_date: today, delivery_date: today, address_id: address, note: "" },
    coLines.map((l) => ({ customer_order_line_id: l.id, qty: l.qty.toNumber(), note: "" })),
    actor
  );
  assert.ok(so.ok, JSON.stringify(so));
  ids.so.push(so.id);
  for (const a of ["submit", "approve", "confirm"] as const) await transitionSalesOrder(so.id, a, actor);
  const soLines = await prisma.salOrderLine.findMany({ where: { order_id: so.id }, orderBy: { line_no: "asc" } });

  const dOrder = await createDeliveryOrder(
    { customer_order_id: co.id, do_date: today, delivery_date: today, warehouse_id: f.warehouse, address_id: address, note: "" },
    soLines.map((l) => ({ sales_order_line_id: l.id, qty: l.qty.toNumber(), note: "" })),
    actor
  );
  assert.ok(dOrder.ok, JSON.stringify(dOrder));
  ids.do.push(dOrder.id);
  assert.deepEqual(await transitionDeliveryOrder(dOrder.id, "issue", actor), { ok: true });
  const doLines = await prisma.salDeliveryOrderLine.findMany({ where: { delivery_order_id: dOrder.id }, orderBy: { line_no: "asc" } });
  return { coId: co.id, soId: so.id, doId: dOrder.id, goods: doLines[0].id, other: doLines[1].id };
}

let order = {} as Awaited<ReturnType<typeof issuedDeliveryOrder>>;

const header = (over: Partial<DeliveryNoteHeaderInput> = {}): DeliveryNoteHeaderInput => ({
  delivery_order_id: order.doId,
  dn_date: today,
  vehicle_no: "B 1234 XYZ",
  driver_name: "Slamet",
  note: "",
  ...over,
});
const line = (qty: number | string, lineId = order.goods): DeliveryNoteLineInput => ({ delivery_order_line_id: lineId, qty, note: "" });

async function create(h = header(), lines = [line(40)]) {
  const r = await createDeliveryNote(h, lines, actor);
  if (r.ok) ids.dn.push(r.id);
  return r;
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  f.box = (await prisma.refUom.create({ data: { uom_code: `test.${key("BOX")}`, uom_label: key("BOX"), uom_name: "Box", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const item = async (l: string) =>
    (
      await prisma.mItem.create({
        data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: cat, base_uom_id: f.pcs, can_sell: true, created_by: actor },
      })
    ).id;
  f.goods = await item("GOODS");
  f.other = await item("OTHER");
  await prisma.mItemUom.create({ data: { item_id: f.goods, uom_id: f.box, factor: 12, created_by: actor } });
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang Uji", created_by: actor } })).id;
  f.customer = await fixtureCustomer();

  const sub = async (label: string) =>
    (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.cogsAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  f.invAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  await setMapping("cogs_account", String(f.cogsAcc));
  await setMapping("inventory_account", String(f.invAcc));

  order = await issuedDeliveryOrder();

  cleanups.push(
    () => prisma.tmpStockMovement.deleteMany({ where: { item_id: { in: [f.goods, f.other] } } }),
    () => prisma.tmpItemCost.deleteMany({ where: { item_id: { in: [f.goods, f.other] } } }),
    () => prisma.mItemUom.deleteMany({ where: { item_id: f.goods } }),
    () => prisma.mItem.deleteMany({ where: { id: { in: [f.goods, f.other] } } }),
    () => prisma.refUom.deleteMany({ where: { id: { in: [f.pcs, f.box] } } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } }),
    () => prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } })
  );
});

after(async () => {
  await prisma.salDeliveryNoteLine.deleteMany({ where: { delivery_note_id: { in: ids.dn } } });
  await prisma.salDeliveryNote.deleteMany({ where: { id: { in: ids.dn } } });
  await prisma.salDeliveryOrderLine.deleteMany({ where: { delivery_order_id: { in: ids.do } } });
  await prisma.salDeliveryOrder.deleteMany({ where: { id: { in: ids.do } } });
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: ids.so } } });
  await prisma.salOrder.deleteMany({ where: { id: { in: ids.so } } });
  await prisma.salCustomerOrderLine.deleteMany({ where: { order_id: { in: ids.co } } });
  await prisma.salCustomerOrder.deleteMany({ where: { id: { in: ids.co } } });
  for (const [k, list] of Object.entries({ sal_delivery_note: ids.dn, sal_delivery_order: ids.do, sal_order: ids.so, sal_customer_order: ids.co })) {
    await prisma.auditLog.deleteMany({ where: { entity_key: k, row_id: { in: list } } });
  }
  const costIds = (await prisma.tmpItemCost.findMany({ where: { item_id: { in: [f.goods, f.other] } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { entity_key: "tmp_item_cost", row_id: { in: costIds } } });
  for (const [k, v] of savedSettings) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  await cleanupFixtures();
  for (const c of cleanups) await c();
  await cleanupFiscalYear();
  await disconnect();
});

// ----------------------------------------------------------------- options

describe("what the form offers", () => {
  test("issued Delivery Orders with something left, with their lines", async () => {
    const o = await deliveryNoteOptions();
    const mine = o.orders.find((x) => x.id === order.doId)!;
    assert.ok(mine, "the issued order is offered");
    assert.deepEqual(
      mine.lines.map((l) => [l.qty, l.uomFactor, l.held]),
      [
        [100, 12, 0],
        [50, 1, 0],
      ]
    );
  });
});

// -------------------------------------------------------------- validation

describe("what a Delivery Note must satisfy", () => {
  test("an issued Delivery Order, a date not before it, and its own lines within what is left", async () => {
    const early = await checkDeliveryNote(prisma, header({ dn_date: "2020-01-01" }), [line(1)], null);
    assert.ok(!early.ok && /sebelum tanggal Delivery Order/.test(early.errors.dn_date));
    const twice = await checkDeliveryNote(prisma, header(), [line(1), line(2)], null);
    assert.ok(!twice.ok && /lebih dari sekali/.test(twice.errors["lines.1.delivery_order_line_id"]));
    const blank = await checkDeliveryNote(prisma, header(), [line("")], null);
    assert.ok(!blank.ok && blank.errors["lines.0.qty"], "a blank quantity is refused on its row");
    const tooMuch = await checkDeliveryNote(prisma, header(), [line(100.0001)], null);
    assert.ok(!tooMuch.ok && /Melebihi sisa Delivery Order/.test(tooMuch.errors["lines.0.qty"]));
    const none = await checkDeliveryNote(prisma, header(), [], null);
    assert.ok(!none.ok && none.errors._lines);
    assert.ok((await checkDeliveryNote(prisma, header(), [line(100), line(50, order.other)], null)).ok, "exactly what is left");
  });
});

// ------------------------------------------------------------ the quantity

describe("Delivery Notes split a Delivery Order", () => {
  test("a Draft reserves its quantity, numbered SJ/YYYY/MM/NNNN, and writes no journal", async () => {
    const journals = await prisma.accJournal.count();
    const r = await create(header(), [line(40)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.dnNo, /^SJ\/\d{4}\/\d{2}\/\d{4}$/);
    assert.equal(await prisma.accJournal.count(), journals);
    const over = await create(header(), [line(61)]);
    assert.ok(!over.ok && /Melebihi sisa Delivery Order \(60/.test(over.errors["lines.0.qty"]), "the Draft holds 40 of 100");
    const kept = await updateDeliveryNote(r.id, header({ vehicle_no: "B 9 UJI" }), [line(40)], actor);
    assert.ok(kept.ok, "editing a Draft does not count against itself");
  });

  test("a cancelled Draft gives its quantity back", async () => {
    const r = await create(header(), [line(10)]);
    assert.ok(r.ok);
    assert.deepEqual(await transitionDeliveryNote(r.id, "cancel", actor), { ok: false, errors: { reason: "Alasan wajib diisi." } });
    assert.deepEqual(await transitionDeliveryNote(r.id, "cancel", actor, "salah input"), { ok: true });
    assert.deepEqual((await deliveryOrderNotes(order.doId)).lines.map((l) => l.held), [40, 0]);
  });
});

// ----------------------------------------------------------------- posting

describe("Posting issues the goods and books HPP only", () => {
  test("refused while an item has no Harga Pokok, naming it", async () => {
    const [first] = ids.dn;
    const preview = (await deliveryNotePreview(first))!;
    assert.equal(preview.missingCost.length, 1);
    const refused = await transitionDeliveryNote(first, "post", actor);
    assert.ok(!refused.ok && /belum punya Harga Pokok/.test(refused.errors._form));
    assert.equal((await getDeliveryNote(first))!.status, "Draft", "nothing was written");
  });

  test("refused while Account Mapping lacks HPP or Persediaan", async () => {
    assert.deepEqual(await setItemCost(f.goods, "2500", actor), { ok: true });
    await setMapping("cogs_account", null);
    const refused = await transitionDeliveryNote(ids.dn[0], "post", actor);
    await setMapping("cogs_account", String(f.cogsAcc));
    assert.ok(!refused.ok && /Account Mapping/.test(refused.errors._form));
  });

  test("40 BOX = 480 PCS × 2.500: Dr HPP 1.200.000 / Cr Persediaan 1.200.000, dated Tanggal Kirim", async () => {
    const [first] = ids.dn;
    const preview = (await deliveryNotePreview(first))!;
    assert.deepEqual([preview.total, preview.missingCost], [1_200_000, []]);
    const arCount = await prisma.finArItem.count();
    const r = await transitionDeliveryNote(first, "post", actor);
    assert.ok(r.ok, JSON.stringify(r));
    const note = (await getDeliveryNote(first))!;
    assert.equal(note.status, "Posted");
    assert.deepEqual(note.lines.map((l) => [l.qty, l.baseQty, l.unitCost, l.cost]), [[40, 480, 2_500, 1_200_000]]);
    assert.equal(note.cost, 1_200_000);
    const journalLines = await prisma.accJournalLine.findMany({ where: { journal_id: note.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(
      journalLines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.cogsAcc, 1_200_000, 0],
        [f.invAcc, 0, 1_200_000],
      ]
    );
    const journal = await prisma.accJournal.findUniqueOrThrow({ where: { id: note.journalId! } });
    assert.equal(journal.posting_date?.toISOString().slice(0, 10), today);
    assert.equal(await prisma.finArItem.count(), arCount, "no Piutang: the Faktur recognises it");
    const moves = await prisma.tmpStockMovement.findMany({ where: { source_doc_id: first, item_id: f.goods } });
    assert.deepEqual(moves.map((m) => [m.warehouse_id, m.base_qty_out.toNumber(), m.cost_amount.toNumber()]), [[f.warehouse, 480, 1_200_000]]);
  });

  test("a posted note is final, and keeps its cost when the Harga Pokok changes", async () => {
    const [first] = ids.dn;
    assert.ok(!(await updateDeliveryNote(first, header(), [line(1)], actor)).ok);
    assert.ok(!(await transitionDeliveryNote(first, "cancel", actor, "x")).ok);
    await setItemCost(f.goods, "3000", actor);
    assert.equal((await getDeliveryNote(first))!.lines[0].unitCost, 2_500);
  });

  test("posting records what left on the Delivery Order and the Sales Order", async () => {
    const doLines = await prisma.salDeliveryOrderLine.findMany({ where: { delivery_order_id: order.doId }, orderBy: { line_no: "asc" } });
    assert.deepEqual(doLines.map((l) => l.delivered_qty.toNumber()), [40, 0]);
    const so = await salesOrderDeliveries(order.soId, order.coId);
    assert.deepEqual(so.lines.map((l) => l.delivered), [40, 0]);
  });
});

// ------------------------------------------------------------------ closing

describe("orders close themselves once fully delivered (U14)", () => {
  test("a Delivery Order with a Draft note refuses Tutup", async () => {
    const draft = await create(header(), [line(60), line(50, order.other)]);
    assert.ok(draft.ok, JSON.stringify(draft));
    const refused = await transitionDeliveryOrder(order.doId, "close", actor, "selesai", liveDeliveryNoteRefusal);
    assert.ok(!refused.ok && new RegExp(draft.dnNo.replace(/\//g, "\\/")).test(refused.errors._form));
  });

  test("the note that sends the rest closes the Delivery Order and the Sales Order", async () => {
    await setItemCost(f.other, "1000", actor);
    const last = ids.dn[ids.dn.length - 1];
    const r = await transitionDeliveryNote(last, "post", actor);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.ok && r.closed?.length, 2, "both named");
    // 60 BOX × 12 × 3.000 + 50 PCS × 1.000
    assert.equal((await getDeliveryNote(last))!.cost, 2_210_000);
    const dOrder = await prisma.salDeliveryOrder.findUniqueOrThrow({ where: { id: order.doId } });
    const sOrder = await prisma.salOrder.findUniqueOrThrow({ where: { id: order.soId } });
    assert.deepEqual([dOrder.status, dOrder.status_reason, sOrder.status, sOrder.status_reason], ["Closed", null, "Closed", null]);
    const events = await prisma.auditLog.findMany({ where: { entity_key: { in: ["sal_delivery_order", "sal_order"] }, row_id: { in: [order.doId, order.soId] }, event: "fulfil" } });
    assert.equal(events.length, 2);
    assert.ok(!(await deliveryNoteOptions()).orders.some((o) => o.id === order.doId), "a closed order takes no new note");
  });

  test("closing by hand after a partial delivery releases what never left", async () => {
    const second = await issuedDeliveryOrder();
    const r = await create(header({ delivery_order_id: second.doId }), [line(30, second.goods)]);
    assert.ok(r.ok);
    assert.ok((await transitionDeliveryNote(r.id, "post", actor)).ok);
    assert.deepEqual(await transitionDeliveryOrder(second.doId, "close", actor, "sisa tidak dikirim", liveDeliveryNoteRefusal), { ok: true });
    // The Sales Order line held 100 BOX by this Delivery Order; now only the 30 that left.
    assert.deepEqual((await salesOrderDeliveries(second.soId, second.coId)).lines.map((l) => l.held), [30, 0]);
    assert.deepEqual(await transitionSalesOrder(second.soId, "close", actor, "selesai", liveDeliveryOrderRefusal), { ok: true });
    // And the Customer Order line now holds only the 30 the Sales Order delivered.
    const coLine = await prisma.salCustomerOrderLine.findFirstOrThrow({ where: { order_id: second.coId }, orderBy: { line_no: "asc" } });
    const held = await prisma.salOrderLine.findFirstOrThrow({ where: { customer_order_line_id: coLine.id } });
    assert.equal(held.delivered_qty.toNumber(), 30);
    assert.deepEqual(await transitionCustomerOrder(second.coId, "close", actor, "selesai", liveSalesOrderRefusal), { ok: true });
  });

  test("Posting and Batalkan are separate permissions; a posted note offers nothing", () => {
    assert.deepEqual(availableDeliveryNoteActions("Draft", deliveryNoteAbilities(["DELIVERY_NOTE_POST"])), ["post"]);
    assert.deepEqual(availableDeliveryNoteActions("Draft", deliveryNoteAbilities(["DELIVERY_NOTE_POST", "DELIVERY_NOTE_CANCEL"])), ["cancel", "post"]);
    assert.deepEqual(availableDeliveryNoteActions("Posted", deliveryNoteAbilities(["DELIVERY_NOTE_POST", "DELIVERY_NOTE_CANCEL"])), []);
  });
});
