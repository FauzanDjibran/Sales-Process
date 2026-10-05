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
import { createStockLot, setItemCost, setStockLotActive } from "../src/lib/erp/inventory";
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
 * closing either by hand releases only what never left. And the stock picking
 * (U15): a Barang with Kelola Stok leaves lot by lot, each pick its own stock
 * movement, and posts only when picked in full.
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
 * An Open Customer Order — 100 PCS of GOODS and 50 PCS of OTHER, each in its
 * base unit, as sales sells (P108) — one Open Sales Order for all of it, and one issued Delivery Order
 * for all of that. Returns the Delivery Order and its line ids.
 */
async function issuedDeliveryOrder(
  items: [item: number, uom: number, qty: number][] = [
    [f.goods, f.pcs, 100],
    [f.other, f.pcs, 50],
  ]
) {
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
    items.map(([item, uom, qty]) => line(item, uom, qty)),
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
  return { coId: co.id, soId: so.id, doId: dOrder.id, goods: doLines[0].id, other: doLines[1]?.id ?? 0 };
}

let order = {} as Awaited<ReturnType<typeof issuedDeliveryOrder>>;

const header = (over: Partial<DeliveryNoteHeaderInput> = {}): DeliveryNoteHeaderInput => ({
  source_doc_id: order.doId,
  dn_date: today,
  vehicle_no: "B 1234 XYZ",
  driver_name: "Slamet",
  note: "",
  ...over,
});
const line = (qty: number | string, lineId = order.goods): DeliveryNoteLineInput => ({ source_doc_line_id: lineId, qty, note: "" });

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
  f.lotted = await item("LOTTED");
  await prisma.mItem.update({ where: { id: f.lotted }, data: { track_stock: true, has_expiry: true } });
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
    () => prisma.tmpStockMovement.deleteMany({ where: { item_id: { in: [f.goods, f.other, f.lotted] } } }),
    () => prisma.tmpItemCost.deleteMany({ where: { item_id: { in: [f.goods, f.other, f.lotted] } } }),
    () => prisma.tmpStockLot.deleteMany({ where: { item_id: { in: [f.goods, f.other, f.lotted] } } }),
    () => prisma.mItemUom.deleteMany({ where: { item_id: f.goods } }),
    () => prisma.mItem.deleteMany({ where: { id: { in: [f.goods, f.other, f.lotted] } } }),
    () => prisma.refUom.deleteMany({ where: { id: { in: [f.pcs, f.box] } } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } }),
    () => prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } })
  );
});

after(async () => {
  await prisma.logDeliveryNoteLot.deleteMany({ where: { line: { delivery_note_id: { in: ids.dn } } } });
  await prisma.logDeliveryNoteLine.deleteMany({ where: { delivery_note_id: { in: ids.dn } } });
  await prisma.logDeliveryNote.deleteMany({ where: { id: { in: ids.dn } } });
  await prisma.salDeliveryOrderLine.deleteMany({ where: { delivery_order_id: { in: ids.do } } });
  await prisma.salDeliveryOrder.deleteMany({ where: { id: { in: ids.do } } });
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: ids.so } } });
  await prisma.salOrder.deleteMany({ where: { id: { in: ids.so } } });
  await prisma.salCustomerOrderLine.deleteMany({ where: { order_id: { in: ids.co } } });
  await prisma.salCustomerOrder.deleteMany({ where: { id: { in: ids.co } } });
  for (const [k, list] of Object.entries({ log_delivery_note: ids.dn, sal_delivery_order: ids.do, sal_order: ids.so, sal_customer_order: ids.co })) {
    await prisma.auditLog.deleteMany({ where: { entity_key: k, row_id: { in: list } } });
  }
  const costIds = (await prisma.tmpItemCost.findMany({ where: { item_id: { in: [f.goods, f.other, f.lotted] } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { entity_key: "tmp_item_cost", row_id: { in: costIds } } });
  const lotIds = (await prisma.tmpStockLot.findMany({ where: { item_id: f.lotted }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { entity_key: "tmp_stock_lot", row_id: { in: lotIds } } });
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
        [100, 1, 0],
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
    assert.ok(!twice.ok && /lebih dari sekali/.test(twice.errors["lines.1.source_doc_line_id"]));
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
  test("a Draft reserves its quantity, numbered SJ-NP/YYYY/MM/NNNN for an order without PPN (P109), and writes no journal", async () => {
    const journals = await prisma.accJournal.count();
    const r = await create(header(), [line(40)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.dnNo, /^SJ-NP\/\d{4}\/\d{2}\/\d{4}$/);
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
    const preview = await deliveryNotePreview(first, actor);
    assert.ok(!preview.ok && /belum punya Harga Pokok/.test(preview.errors._form), "the dialog refuses in Posting's own words");
    const refused = await transitionDeliveryNote(first, "post", actor);
    assert.ok(!refused.ok && /belum punya Harga Pokok/.test(refused.errors._form));
    assert.equal((await getDeliveryNote(first))!.status, "Draft", "nothing was written");
  });

  test("refused while Account Mapping lacks HPP or Persediaan", async () => {
    assert.deepEqual(await setItemCost(f.goods, "30000", actor), { ok: true });
    await setMapping("cogs_account", null);
    const refused = await transitionDeliveryNote(ids.dn[0], "post", actor);
    await setMapping("cogs_account", String(f.cogsAcc));
    assert.ok(!refused.ok && /Account Mapping/.test(refused.errors._form));
  });

  test("40 PCS × 30.000: Dr HPP 1.200.000 / Cr Persediaan 1.200.000, dated Tanggal Kirim", async () => {
    const [first] = ids.dn;
    const movesBefore = await prisma.tmpStockMovement.count();
    const preview = await deliveryNotePreview(first, actor);
    assert.ok(preview.ok, !preview.ok ? JSON.stringify(preview.errors) : "");
    assert.deepEqual(preview.lines.map((l) => [l.debit, l.credit]), [[1_200_000, 0], [0, 1_200_000]]);
    assert.equal(await prisma.tmpStockMovement.count(), movesBefore, "a dry run issues no stock");
    assert.equal((await getDeliveryNote(first))!.status, "Draft", "and leaves the note a Draft");
    const arCount = await prisma.finArItem.count();
    const r = await transitionDeliveryNote(first, "post", actor);
    assert.ok(r.ok, JSON.stringify(r));
    const note = (await getDeliveryNote(first))!;
    assert.equal(note.status, "Posted");
    assert.deepEqual(note.lines.map((l) => [l.qty, l.baseQty, l.unitCost, l.cost]), [[40, 40, 30_000, 1_200_000]]);
    assert.equal(note.cost, 1_200_000);
    const journalLines = await prisma.accJournalLine.findMany({ where: { journal_id: note.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(
      journalLines.map((l) => [l.account_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.cogsAcc, 1_200_000, 0],
        [f.invAcc, 0, 1_200_000],
      ]
    );
    assert.deepEqual(
      preview.lines.map((l) => [l.debit, l.credit, l.description]),
      journalLines.map((l) => [l.debit_amount.toNumber(), l.kredit_amount.toNumber(), l.description]),
      "the dialog showed the journal Posting wrote"
    );
    const journal = await prisma.accJournal.findUniqueOrThrow({ where: { id: note.journalId! } });
    assert.equal(journal.posting_date?.toISOString().slice(0, 10), today);
    assert.equal(await prisma.finArItem.count(), arCount, "no Piutang: the Invoice recognises it");
    const moves = await prisma.tmpStockMovement.findMany({ where: { source_doc_id: first, item_id: f.goods } });
    assert.deepEqual(moves.map((m) => [m.warehouse_id, m.base_qty_out.toNumber(), m.cost_amount.toNumber()]), [[f.warehouse, 40, 1_200_000]]);
  });

  test("a posted note is final, and keeps its cost when the Harga Pokok changes", async () => {
    const [first] = ids.dn;
    assert.ok(!(await updateDeliveryNote(first, header(), [line(1)], actor)).ok);
    assert.ok(!(await transitionDeliveryNote(first, "cancel", actor, "x")).ok);
    await setItemCost(f.goods, "36000", actor);
    assert.equal((await getDeliveryNote(first))!.lines[0].unitCost, 30_000);
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

  test("the note that sends the rest closes the Delivery Order, the Sales Order and the Customer Order", async () => {
    await setItemCost(f.other, "1000", actor);
    const last = ids.dn[ids.dn.length - 1];
    const r = await transitionDeliveryNote(last, "post", actor);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.ok && r.closed?.length, 3, "the Delivery Order, the Sales Order and the Customer Order (U21) named");
    // 60 PCS × 36.000 + 50 PCS × 1.000
    assert.equal((await getDeliveryNote(last))!.cost, 2_210_000);
    const dOrder = await prisma.salDeliveryOrder.findUniqueOrThrow({ where: { id: order.doId } });
    const sOrder = await prisma.salOrder.findUniqueOrThrow({ where: { id: order.soId } });
    const cOrder = await prisma.salCustomerOrder.findUniqueOrThrow({ where: { id: order.coId } });
    assert.deepEqual(
      [dOrder.status, dOrder.status_reason, sOrder.status, sOrder.status_reason, cOrder.status, cOrder.status_reason],
      ["Closed", null, "Closed", null, "Closed", null]
    );
    // Each table with its own id: across two tables an id alone can belong to another record.
    const events = await prisma.auditLog.findMany({
      where: {
        event: "fulfil",
        OR: [
          { entity_key: "sal_delivery_order", row_id: order.doId },
          { entity_key: "sal_order", row_id: order.soId },
        ],
      },
    });
    assert.equal(events.length, 2);
    assert.ok(!(await deliveryNoteOptions()).orders.some((o) => o.id === order.doId), "a closed order takes no new note");
  });

  test("closing by hand after a partial delivery releases what never left", async () => {
    const second = await issuedDeliveryOrder();
    const r = await create(header({ source_doc_id: second.doId }), [line(30, second.goods)]);
    assert.ok(r.ok);
    assert.ok((await transitionDeliveryNote(r.id, "post", actor)).ok);
    assert.deepEqual(await transitionDeliveryOrder(second.doId, "close", actor, "sisa tidak dikirim", liveDeliveryNoteRefusal), { ok: true });
    // The Sales Order line held 100 PCS by this Delivery Order; now only the 30 that left.
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

// ------------------------------------------------------------ stock picking

describe("a Barang with Kelola Stok leaves lot by lot (U15)", () => {
  const lot = {} as Record<string, number>;
  let lotted = {} as Awaited<ReturnType<typeof issuedDeliveryOrder>>;
  const pick = (qty: number, picks: [lot: number, qty: number | string][]): DeliveryNoteLineInput => ({
    source_doc_line_id: lotted.goods,
    qty,
    note: "",
    picks: picks.map(([lot_id, q]) => ({ lot_id, qty: q })),
  });
  const lotHeader = () => header({ source_doc_id: lotted.doId });

  test("a lot belongs to a Barang with Kelola Stok, in one warehouse, with its expiry when the item has one", async () => {
    const add = (item: number, lotNo: string, expiry = "") =>
      createStockLot({ item_id: item, warehouse_id: f.warehouse, lot_no: lotNo, expiry_date: expiry }, actor);
    const plain = await add(f.goods, key("L0"));
    assert.ok(!plain.ok && /Kelola Stok/.test(plain.errors.item_id));
    const noExpiry = await add(f.lotted, key("L0"));
    assert.ok(!noExpiry.ok && /kadaluarsa/.test(noExpiry.errors.expiry_date));
    assert.deepEqual(await add(f.lotted, key("late").toLowerCase(), "2031-12-31"), { ok: true });
    assert.deepEqual(await add(f.lotted, key("early"), "2030-06-30"), { ok: true });
    assert.deepEqual(await add(f.lotted, key("gone"), "2029-01-31"), { ok: true });
    const dup = await add(f.lotted, key("early"), "2030-06-30");
    assert.ok(!dup.ok && /sudah ada/.test(dup.errors.lot_no));
    const rows = await prisma.tmpStockLot.findMany({ where: { item_id: f.lotted } });
    for (const r of rows) lot[r.lot_no.slice(FIXTURE_PREFIX.length, -stamp.length).toLowerCase()] = r.id;
    assert.ok(rows.every((r) => r.lot_no === r.lot_no.toUpperCase()), "lot numbers are kept upper case");
    assert.deepEqual(await setStockLotActive(lot.gone, false, actor), { ok: true });
  });

  test("the form offers the active lots, earliest expiry first, and marks the line lot-tracked", async () => {
    lotted = await issuedDeliveryOrder([[f.lotted, f.pcs, 30]]);
    const o = (await deliveryNoteOptions()).orders.find((x) => x.id === lotted.doId)!;
    assert.deepEqual(o.lines.map((l) => l.lotTracked), [true]);
    assert.deepEqual(o.lots[f.lotted].map((l) => l.id), [lot.early, lot.late], "the inactive lot is not offered");
    const plain = (await deliveryNoteOptions()).orders.find((x) => x.id === order.doId);
    assert.ok(!plain || plain.lines.every((l) => !l.lotTracked));
  });

  test("picks are lots of the item, each once, never more than the line; a line without lots takes none", async () => {
    const other = await prisma.tmpStockLot.create({
      data: { item_id: f.goods, warehouse_id: f.warehouse, lot_no: key("WRONG"), created_by: actor },
    });
    const wrong = await checkDeliveryNote(prisma, lotHeader(), [pick(10, [[other.id, 10]])], null);
    await prisma.tmpStockLot.delete({ where: { id: other.id } });
    assert.ok(!wrong.ok && /Lot tidak ada/.test(wrong.errors["lines.0.picks"]));
    const inactive = await checkDeliveryNote(prisma, lotHeader(), [pick(10, [[lot.gone, 10]])], null);
    assert.ok(!inactive.ok && /Lot tidak ada/.test(inactive.errors["lines.0.picks"]), "an inactive lot cannot be picked");
    const twice = await checkDeliveryNote(prisma, lotHeader(), [pick(10, [[lot.early, 5], [lot.early, 5]])], null);
    assert.ok(!twice.ok && /lebih dari sekali/.test(twice.errors["lines.0.picks"]));
    const over = await checkDeliveryNote(prisma, lotHeader(), [pick(10, [[lot.early, 6], [lot.late, 5]])], null);
    assert.ok(!over.ok && /melebihi Qty baris/.test(over.errors["lines.0.picks"]));
    const plain = await issuedDeliveryOrder([[f.other, f.pcs, 1]]);
    const onPlain = await checkDeliveryNote(
      prisma,
      header({ source_doc_id: plain.doId }),
      [{ source_doc_line_id: plain.goods, qty: 1, note: "", picks: [{ lot_id: lot.early, qty: 1 }] }],
      null
    );
    assert.ok(!onPlain.ok && /tidak dikelola per lot/.test(onPlain.errors["lines.0.picks"]));
  });

  test("a Draft may be picked in part; Posting refuses it, naming the line", async () => {
    const r = await create(lotHeader(), [pick(30, [[lot.early, 10]])]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual((await getDeliveryNote(r.id))!.lines[0].pickedLots.map((p) => [p.lotId, p.qty, p.expiry]), [[lot.early, 10, "2030-06-30"]]);
    await setItemCost(f.lotted, "1500", actor);
    const preview = await deliveryNotePreview(r.id, actor);
    assert.ok(!preview.ok && /Pilih lot sampai penuh/.test(preview.errors._form), "the dialog refuses in Posting's own words");
    const refused = await transitionDeliveryNote(r.id, "post", actor);
    assert.ok(!refused.ok && /Pilih lot sampai penuh/.test(refused.errors._form));
    assert.equal((await getDeliveryNote(r.id))!.status, "Draft");
  });

  test("picked in full, each lot leaves as its own stock movement and the line costs what its picks cost", async () => {
    const id = ids.dn[ids.dn.length - 1];
    assert.ok((await updateDeliveryNote(id, lotHeader(), [pick(30, [[lot.early, 20], [lot.late, 10]])], actor)).ok);
    const preview = await deliveryNotePreview(id, actor);
    assert.ok(preview.ok, !preview.ok ? JSON.stringify(preview.errors) : "");
    assert.equal(preview.lines.reduce((t, l) => t + l.debit, 0), 45_000, "costed pick by pick, as Posting costs it");
    const r = await transitionDeliveryNote(id, "post", actor);
    assert.ok(r.ok, JSON.stringify(r));
    const note = (await getDeliveryNote(id))!;
    assert.deepEqual(note.lines.map((l) => [l.qty, l.baseQty, l.unitCost, l.cost]), [[30, 30, 1_500, 45_000]]);
    assert.deepEqual(note.lines[0].pickedLots.map((p) => [p.lotId, p.qty, p.cost]), [
      [lot.early, 20, 30_000],
      [lot.late, 10, 15_000],
    ]);
    const moves = await prisma.tmpStockMovement.findMany({ where: { source_doc_id: id, item_id: f.lotted }, orderBy: { id: "asc" } });
    assert.deepEqual(
      moves.map((m) => [m.lot_id, m.base_qty_out.toNumber(), m.cost_amount.toNumber()]),
      [
        [lot.early, 20, 30_000],
        [lot.late, 10, 15_000],
      ]
    );
    const journalLines = await prisma.accJournalLine.findMany({ where: { journal_id: note.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(journalLines.map((l) => [l.debit_amount.toNumber(), l.kredit_amount.toNumber()]), [
      [45_000, 0],
      [0, 45_000],
    ]);
  });

  test("a lot deactivated after it was picked stops the Draft from posting", async () => {
    const again = await issuedDeliveryOrder([[f.lotted, f.pcs, 5]]);
    const r = await create(header({ source_doc_id: again.doId }), [
      { source_doc_line_id: again.goods, qty: 5, note: "", picks: [{ lot_id: lot.late, qty: 5 }] },
    ]);
    assert.ok(r.ok, JSON.stringify(r));
    await setStockLotActive(lot.late, false, actor);
    const refused = await transitionDeliveryNote(r.id, "post", actor);
    await setStockLotActive(lot.late, true, actor);
    assert.ok(!refused.ok && /Lot tidak ada/.test(refused.errors._form));
    const shown = (await deliveryNoteOptions({ id: r.id, sourceId: again.doId, lotIds: [lot.late] })).orders.find((o) => o.id === again.doId)!;
    assert.ok(shown.lots[f.lotted].some((l) => l.id === lot.late), "the stored note still reads its lot");
  });
});
