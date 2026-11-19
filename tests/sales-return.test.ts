import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createCustomerOrder, transitionCustomerOrder } from "../src/lib/erp/customer-order";
import { createSalesOrder, transitionSalesOrder } from "../src/lib/erp/sales-order";
import { createDeliveryOrder, transitionDeliveryOrder } from "../src/lib/erp/delivery-order";
import { createDeliveryNote, invoiceSourceLines, transitionDeliveryNote } from "../src/lib/erp/delivery-note";
import { createInvoice, invoiceOptions, invoicePayStates, transitionInvoice, unpaidSalesInvoiceIds } from "../src/lib/erp/ar-invoice";
import { cashReceiptOptions, createCashReceipt, transitionCashReceipt } from "../src/lib/erp/cash-bank-tx";
import { cashPaymentOptions, createCashPayment, transitionCashPayment } from "../src/lib/erp/cash-payment";
import { arBook, openArItemsAsOf } from "../src/lib/erp/ar-item";
import { foldAging } from "../src/lib/erp/ar-aging";
import { createCreditNote, creditNoteOptions, creditNotePreview, transitionCreditNote, updateCreditNote } from "../src/lib/erp/ar-credit-note";
import {
  checkSalesReturn,
  createSalesReturn,
  getSalesReturn,
  salesReturnOptions,
  transitionSalesReturn,
  updateSalesReturn,
  type SalesReturnHeaderInput,
  type SalesReturnLineInput,
} from "../src/lib/erp/sales-return";
import { availableSalesReturnActions, salesReturnAbilities } from "../src/lib/erp/sales-return-workflow";
import { createReceiptNote, liveReturnReceiptRefusal, returnReceiptOptions, transitionReceiptNote, updateReceiptNote } from "../src/lib/erp/receipt-note";
import { SALES_RETURN } from "../src/lib/erp/receipt-note-workflow";
import {
  FIXTURE_PREFIX,
  cleanupFiscalYear,
  cleanupFixtures,
  cleanupStock,
  disconnect,
  makeAccount,
  makePartner,
  openFiscalYear,
  prisma,
  stockIn,
  systemUserId,
} from "./helpers";

/**
 * The Sales Return (P287, `Sales-Return-Plan.md` §4): goods of one Customer
 * Order coming back from its posted Delivery Notes. What may be saved; that the
 * returns on a Delivery Note line never take more than what left on it — a
 * cancelled or rejected one gives it back, a closed one keeps only what was
 * received; the approval lifecycle; and that it posts nothing.
 */

const today = new Date().toISOString().slice(0, 10);
let actor = 0;
const f = {} as Record<string, number>;
const ids = { co: [] as number[], so: [] as number[], do: [] as number[], dn: [] as number[], sr: [] as number[], rn: [] as number[], inv: [] as number[], cn: [] as number[], rc: [] as number[] };
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

/** A posted Delivery Note of 40 of the 100 GOODS ordered, and the 50 OTHER not yet sent. */
const flow = { coId: 0, dnLine: 0, address: 0 };

const header = (over: Partial<SalesReturnHeaderInput> = {}): SalesReturnHeaderInput => ({
  customer_order_id: flow.coId,
  return_date: today,
  address_id: flow.address,
  reason: "damaged",
  reason_note: "",
  customer_return_no: "",
  customer_return_date: "",
  note: "",
  ...over,
});
const line = (qty: number | string, lineId = flow.dnLine): SalesReturnLineInput => ({ delivery_note_line_id: lineId, qty, note: "" });

async function create(h = header(), lines = [line(10)]) {
  const r = await createSalesReturn(h, lines, actor);
  if (r.ok) ids.sr.push(r.id);
  return r;
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  f.goods = (
    await prisma.mItem.create({
      data: { item_code: `test.${key("GOODS")}`, item_label: key("GOODS"), item_name: "Goods", item_type: "Barang", category_id: cat, base_uom_id: f.pcs, can_sell: true, track_stock: true, created_by: actor },
    })
  ).id;
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang Uji", created_by: actor } })).id;
  f.customer = await makePartner({ categoryLabel: "Customer" });
  await prisma.mPartner.update({
    where: { id: f.customer },
    data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true },
  });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  flow.address = (await prisma.mPartnerAddress.create({ data: { partner_id: f.customer, village_id: village.id, street: "Kantor", created_by: actor } })).id;
  f.lot = await stockIn(f.goods, f.warehouse, key("G1"), 100, 1_000_000);

  const sub = async (label: string) =>
    (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  await setMapping("cogs_account", String(await makeAccount({ subcategoryLabel: await sub("5") })));
  await setMapping("inventory_account", String(await makeAccount({ subcategoryLabel: await sub("1") })));
  const catAccounts = await prisma.accItemCategoryAccount.findUnique({ where: { category_id: cat } });
  if (catAccounts) {
    await prisma.accItemCategoryAccount.update({ where: { category_id: cat }, data: { inventory_account_id: null, cogs_account_id: null } });
    cleanups.push(() =>
      prisma.accItemCategoryAccount.update({
        where: { category_id: cat },
        data: { inventory_account_id: catAccounts.inventory_account_id, cogs_account_id: catAccounts.cogs_account_id },
      })
    );
  }

  const co = await createCustomerOrder(
    {
      order_date: today,
      customer_id: f.customer,
      address_id: flow.address,
      term_id: f.term,
      price_mode: "Exclude",
      is_taxable: true,
      po_no: "",
      po_date: "",
      salesperson: "",
      note: "",
    },
    [{ item_id: f.goods, uom_id: f.pcs, qty: 100, price: 1_000, discount_type: null, discount_value: null, withholding_tax_id: null, note: "" }],
    actor
  );
  assert.ok(co.ok, JSON.stringify(co));
  ids.co.push(co.id);
  await transitionCustomerOrder(co.id, "submit", actor);
  await transitionCustomerOrder(co.id, "approve", actor);
  const coLine = await prisma.salCustomerOrderLine.findFirstOrThrow({ where: { order_id: co.id } });
  const so = await createSalesOrder(
    { customer_order_id: co.id, order_date: today, delivery_date: today, address_id: flow.address, note: "" },
    [{ customer_order_line_id: coLine.id, qty: 100, note: "" }],
    actor
  );
  assert.ok(so.ok, JSON.stringify(so));
  ids.so.push(so.id);
  for (const a of ["submit", "approve", "confirm"] as const) await transitionSalesOrder(so.id, a, actor);
  const soLine = await prisma.salOrderLine.findFirstOrThrow({ where: { order_id: so.id } });
  const dOrder = await createDeliveryOrder(
    { customer_order_id: co.id, do_date: today, delivery_date: today, warehouse_id: f.warehouse, address_id: flow.address, note: "" },
    [{ sales_order_line_id: soLine.id, qty: 100, note: "" }],
    actor
  );
  assert.ok(dOrder.ok, JSON.stringify(dOrder));
  ids.do.push(dOrder.id);
  await transitionDeliveryOrder(dOrder.id, "issue", actor);
  const doLine = await prisma.salDeliveryOrderLine.findFirstOrThrow({ where: { delivery_order_id: dOrder.id } });
  const dn = await createDeliveryNote(
    { source_doc_id: dOrder.id, dn_date: today, vehicle_no: "", driver_name: "", note: "" },
    [{ source_doc_line_id: doLine.id, qty: 40, note: "", picks: [{ tracking_id: f.lot, base_qty: 40 }] }],
    actor
  );
  assert.ok(dn.ok, JSON.stringify(dn));
  ids.dn.push(dn.id);
  const posted = await transitionDeliveryNote(dn.id, "post", actor);
  assert.ok(posted.ok, JSON.stringify(posted));
  flow.coId = co.id;
  flow.dnLine = (await prisma.logDeliveryNoteLine.findFirstOrThrow({ where: { delivery_note_id: dn.id } })).id;

  cleanups.push(
    () => cleanupStock([f.goods]),
    () => prisma.mItem.deleteMany({ where: { id: f.goods } }),
    () => prisma.refUom.deleteMany({ where: { id: f.pcs } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } }),
    () => prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } })
  );
});

after(async () => {
  await prisma.finArCreditNoteLine.deleteMany({ where: { credit_note_id: { in: ids.cn } } });
  await prisma.finArCreditNote.deleteMany({ where: { id: { in: ids.cn } } });
  const items = await prisma.finArItem.findMany({ where: { partner_id: f.customer }, select: { id: true } });
  await prisma.finArLedger.deleteMany({ where: { item_id: { in: items.map((i) => i.id) } } });
  await prisma.finArItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
  await prisma.finArInvoiceCreditUse.deleteMany({ where: { invoice_id: { in: ids.inv } } });
  await prisma.finArInvoiceLine.deleteMany({ where: { invoice_id: { in: ids.inv } } });
  await prisma.finArInvoice.deleteMany({ where: { id: { in: ids.inv } } });
  await prisma.finCashBankTx.deleteMany({ where: { id: { in: ids.rc } } });
  for (const [k, list] of Object.entries({ fin_ar_credit_note: ids.cn, fin_ar_invoice: ids.inv, fin_cash_bank_tx: ids.rc })) {
    await prisma.auditLog.deleteMany({ where: { entity_key: k, row_id: { in: list } } });
  }
  await prisma.logReceiptNote.deleteMany({ where: { id: { in: ids.rn } } });
  await prisma.auditLog.deleteMany({ where: { entity_key: "log_receipt_note", row_id: { in: ids.rn } } });
  await prisma.salReturnLine.deleteMany({ where: { return_id: { in: ids.sr } } });
  await prisma.salReturn.deleteMany({ where: { id: { in: ids.sr } } });
  await prisma.logDeliveryNoteTracking.deleteMany({ where: { line: { delivery_note_id: { in: ids.dn } } } });
  await prisma.logDeliveryNoteLine.deleteMany({ where: { delivery_note_id: { in: ids.dn } } });
  await prisma.logDeliveryNote.deleteMany({ where: { id: { in: ids.dn } } });
  await prisma.salDeliveryOrderLine.deleteMany({ where: { delivery_order_id: { in: ids.do } } });
  await prisma.salDeliveryOrder.deleteMany({ where: { id: { in: ids.do } } });
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: ids.so } } });
  await prisma.salOrder.deleteMany({ where: { id: { in: ids.so } } });
  await prisma.salCustomerOrderLine.deleteMany({ where: { order_id: { in: ids.co } } });
  await prisma.salCustomerOrder.deleteMany({ where: { id: { in: ids.co } } });
  for (const [k, list] of Object.entries({ sal_return: ids.sr, log_delivery_note: ids.dn, sal_delivery_order: ids.do, sal_order: ids.so, sal_customer_order: ids.co })) {
    await prisma.auditLog.deleteMany({ where: { entity_key: k, row_id: { in: list } } });
  }
  for (const [k, v] of savedSettings) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  await cleanupFixtures();
  for (const c of cleanups) await c();
  await cleanupFiscalYear();
  await disconnect();
});

describe("what the form offers", () => {
  test("the Customer Order with a posted Delivery Note, and that note's line with what left", async () => {
    const o = await salesReturnOptions(flow.coId);
    assert.ok(o.orders.some((x) => x.id === flow.coId), "the order is offered");
    assert.deepEqual(
      o.source?.lines.map((l) => [l.id, l.baseQty, l.held]),
      [[flow.dnLine, 40, 0]],
      "only what left on a posted note, not the 60 never sent"
    );
  });
});

describe("what a Sales Return must satisfy", () => {
  test("an approved order, a reason, its own posted note lines within what left", async () => {
    const noReason = await checkSalesReturn(prisma, header({ reason: "" }), [line(1)], null);
    assert.ok(!noReason.ok && noReason.errors.reason);
    const other = await checkSalesReturn(prisma, header({ reason: "other" }), [line(1)], null);
    assert.ok(!other.ok && other.errors.reason_note, "Lainnya needs an explanation");
    const early = await checkSalesReturn(prisma, header({ return_date: "2020-01-01" }), [line(1)], null);
    assert.ok(!early.ok && early.errors.return_date);
    const twice = await checkSalesReturn(prisma, header(), [line(1), line(2)], null);
    assert.ok(!twice.ok && /lebih dari sekali/.test(twice.errors["lines.1.delivery_note_line_id"]));
    const tooMuch = await checkSalesReturn(prisma, header(), [line(40.0001)], null);
    assert.ok(!tooMuch.ok && /Melebihi sisa/.test(tooMuch.errors["lines.0.qty"]));
    const stranger = await checkSalesReturn(prisma, header(), [line(1, 0)], null);
    assert.ok(!stranger.ok && stranger.errors["lines.0.delivery_note_line_id"]);
    const none = await checkSalesReturn(prisma, header(), [], null);
    assert.ok(!none.ok && none.errors._lines);
    assert.ok((await checkSalesReturn(prisma, header(), [line(40)], null)).ok, "exactly what left");
  });
});

describe("returns share what left on a note line", () => {
  test("a Draft holds its quantity, numbered SR/YYYY/MM/NNNN, and writes nothing to the books", async () => {
    const journals = await prisma.accJournal.count();
    const stock = await prisma.logStockLedger.count();
    const r = await create(header(), [line(30)]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.returnNo, /^SR\/\d{4}\/\d{2}\/\d{4,}$/);
    assert.equal(await prisma.accJournal.count(), journals);
    assert.equal(await prisma.logStockLedger.count(), stock);
    const o = await salesReturnOptions(flow.coId);
    assert.equal(o.source?.lines[0].held, 30);
    const second = await checkSalesReturn(prisma, header(), [line(11)], null);
    assert.ok(!second.ok && /Melebihi sisa/.test(second.errors["lines.0.qty"]), "only 10 left");
    // Its own quantity never counts against itself on edit.
    const upd = await updateSalesReturn(r.id, header({ note: "ubah" }), [line(40)], actor);
    assert.ok(upd.ok, JSON.stringify(upd));
  });

  test("cancelling and rejecting give the quantity back", async () => {
    const draft = (await getSalesReturn(ids.sr[0]))!;
    assert.deepEqual(await transitionSalesReturn(draft.id, "cancel", actor, "salah input"), { ok: true });
    const r = await create(header(), [line(40)]);
    assert.ok(r.ok);
    assert.deepEqual(await transitionSalesReturn(r.id, "submit", actor), { ok: true });
    assert.deepEqual(await transitionSalesReturn(r.id, "reject", actor, "tidak terbukti rusak"), { ok: true });
    const o = await salesReturnOptions(flow.coId);
    assert.equal(o.source?.lines[0].held, 0);
  });

  test("approved, then closed by hand: it keeps only what was received", async () => {
    const r = await create(header(), [line(25)]);
    assert.ok(r.ok);
    assert.deepEqual(await transitionSalesReturn(r.id, "approve", actor), {
      ok: false,
      errors: { _form: "Sales Return berstatus ini tidak dapat di-setujui." },
    });
    assert.deepEqual(await transitionSalesReturn(r.id, "submit", actor), { ok: true });
    const locked = await updateSalesReturn(r.id, header(), [line(5)], actor);
    assert.ok(!locked.ok && locked.errors._form, "a submitted return is not edited");
    assert.deepEqual(await transitionSalesReturn(r.id, "approve", actor), { ok: true });
    assert.equal((await getSalesReturn(r.id))!.status, "Open");
    const noReason = await transitionSalesReturn(r.id, "close", actor, "");
    assert.ok(!noReason.ok && noReason.errors.reason);
    // What a Receipt Note would write once received (step 2).
    await prisma.salReturnLine.updateMany({ where: { return_id: r.id }, data: { received_qty: 5 } });
    assert.deepEqual(await transitionSalesReturn(r.id, "close", actor, "sisanya tidak dikirim"), { ok: true });
    const o = await salesReturnOptions(flow.coId);
    assert.equal(o.source?.lines[0].held, 5);
  });

  test("the header offers only what the status and the permissions allow", () => {
    const all = salesReturnAbilities(["SALES_RETURN_SUBMIT", "SALES_RETURN_APPROVE", "SALES_RETURN_CANCEL", "SALES_RETURN_CLOSE"]);
    assert.deepEqual(availableSalesReturnActions("Draft", all), ["cancel", "submit"]);
    assert.deepEqual(availableSalesReturnActions("Submitted", all), ["reject", "approve"]);
    assert.deepEqual(availableSalesReturnActions("Open", all), ["close"]);
    assert.deepEqual(availableSalesReturnActions("Closed", all), []);
  });
});

// ------------------------------------------- step 2: the goods come back (P288)

describe("a Receipt Note sales_return brings the goods back", () => {
  let srId = 0;
  let srLine = 0;
  let dnTracking = 0;
  const lot = (qty: number, statusId: number) => ({ tracking_no: "", expiry_date: "", source_tracking_id: dnTracking, qty, location_id: null, stock_status_id: statusId });
  const head = () => ({ purpose: SALES_RETURN, source_doc_id: srId, rn_date: today, warehouse_id: f.warehouse, supplier_dn_no: "", note: "" });

  before(async () => {
    const r = await create(header(), [line(10)]);
    assert.ok(r.ok, JSON.stringify(r));
    srId = r.id;
    for (const a of ["submit", "approve"] as const) assert.deepEqual(await transitionSalesReturn(srId, a, actor), { ok: true });
    srLine = (await prisma.salReturnLine.findFirstOrThrow({ where: { return_id: srId } })).id;
    dnTracking = (await prisma.logDeliveryNoteTracking.findFirstOrThrow({ where: { delivery_note_line_id: flow.dnLine } })).id;
    f.available = (await prisma.sysStockStatus.findUniqueOrThrow({ where: { status_label: "TERSEDIA" } })).id;
    f.blocked = (await prisma.sysStockStatus.findFirstOrThrow({ where: { status_label: { not: "TERSEDIA" } } })).id;
  });

  test("offers the Open return with the lot that left and what may come back", async () => {
    const o = await returnReceiptOptions();
    const mine = o.returns.find((r) => r.id === srId)!;
    assert.ok(mine, "the Open return is offered");
    assert.deepEqual(mine.lines.map((l) => [l.qty, l.held, l.warehouseId, l.trackings.map((t) => [t.id, t.baseQty, t.room, t.cost])]), [
      [10, 0, f.warehouse, [[dnTracking, 40, 40, 400_000]]],
    ]);
  });

  test("refuses lots it cannot take, and a Draft holds the return and blocks Tutup", async () => {
    const tooMuch = await createReceiptNote(head(), [{ source_doc_line_id: srLine, qty: 11, note: "", lots: [lot(11, f.available)] }], actor);
    assert.ok(!tooMuch.ok && /Melebihi sisa Sales Return/.test(tooMuch.errors["lines.0.qty"]));
    const noStatus = await createReceiptNote(head(), [{ source_doc_line_id: srLine, qty: 4, note: "", lots: [lot(4, 0)] }], actor);
    assert.ok(!noStatus.ok && /status stok/.test(noStatus.errors["lines.0.lots"]));
    const r = await createReceiptNote(head(), [{ source_doc_line_id: srLine, qty: 4, note: "", lots: [lot(4, f.available)] }], actor);
    assert.ok(r.ok, JSON.stringify(r));
    ids.rn.push(r.id);
    assert.match(r.rnNo, /^RN\/\d{4}\/\d{2}\/\d{4,}$/, "the Customer Order has PPN, so the plain series (P109)");
    assert.match((await prisma.$transaction((tx) => liveReturnReceiptRefusal(tx, srId))) ?? "", /Receipt Note Draft/);
    const partial = await transitionReceiptNote(r.id, "post", actor);
    assert.ok(partial.ok, JSON.stringify(partial));
    // The second receipt brings the rest, part of it held back.
    const rest = await createReceiptNote(head(), [{ source_doc_line_id: srLine, qty: 6, note: "", lots: [lot(4, f.available), lot(1, f.blocked)] }], actor);
    assert.ok(rest.ok, JSON.stringify(rest));
    ids.rn.push(rest.id);
    const short = await transitionReceiptNote(rest.id, "post", actor);
    assert.ok(!short.ok && /Lengkapi lotnya/.test(short.errors._form), "posting needs the lots in full");
    assert.ok((await updateReceiptNote(rest.id, head(), [{ source_doc_line_id: srLine, qty: 6, note: "", lots: [lot(5, f.available), lot(1, f.blocked)] }], actor)).ok);
  });

  test("posting returns the stock at the value it left at, reverses HPP and closes the return", async () => {
    const [first, second] = ids.rn;
    const firstNote = await prisma.logReceiptNote.findUniqueOrThrow({ where: { id: first }, include: { lines: { include: { trackings: true } } } });
    assert.equal(firstNote.value_amount.toNumber(), 40_000, "4 of the 40 that left at 400.000");
    const posted = await transitionReceiptNote(second, "post", actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    assert.deepEqual(posted.closed, [(await getSalesReturn(srId))!.returnNo], "every line back: the return closes itself");
    const note = await prisma.logReceiptNote.findUniqueOrThrow({ where: { id: second } });
    assert.equal(note.value_amount.toNumber(), 60_000, "6 of the 40 at 10.000 each, cumulative");
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: note.journal_id! } });
    const cogs = Number((await prisma.sysSetting.findUniqueOrThrow({ where: { setting_key: "cogs_account" } })).setting_value);
    const inv = Number((await prisma.sysSetting.findUniqueOrThrow({ where: { setting_key: "inventory_account" } })).setting_value);
    assert.equal(lines.filter((l) => l.account_id === inv).reduce((a, l) => a + l.debit_amount.toNumber(), 0), 60_000);
    assert.equal(lines.filter((l) => l.account_id === cogs).reduce((a, l) => a + l.kredit_amount.toNumber(), 0), 60_000);
    const back = await prisma.logStockBalance.findMany({ where: { item_id: f.goods, warehouse_id: f.warehouse, tracking_id: f.lot } });
    assert.equal(back.find((b) => b.stock_status_id === f.available)?.qty_balance.toNumber(), 60 + 9, "the same lot, Tersedia");
    assert.equal(back.find((b) => b.stock_status_id === f.blocked)?.qty_balance.toNumber(), 1, "one held back under its own status");
    assert.equal((await prisma.salReturnLine.findUniqueOrThrow({ where: { id: srLine } })).received_qty.toNumber(), 10);
    assert.equal((await prisma.logDeliveryNoteLine.findUniqueOrThrow({ where: { id: flow.dnLine } })).returned_qty.toNumber(), 10);
  });
});

// ------------------------------------- step 3: the Invoice bills what is left (P287)

describe("the Invoice bills what is left after returns", () => {
  test("a note line with 10 of its 40 back offers 30 to bill, and says what came back", async () => {
    const [line] = await invoiceSourceLines({ lineIds: [flow.dnLine] });
    assert.equal(line.qty, 30);
    assert.equal(line.returnedQty, 10);
    const o = await invoiceOptions();
    const mine = o.orders.find((x) => x.id === flow.coId)?.noteLines.find((l) => l.id === flow.dnLine);
    assert.equal(mine?.qty, 30, "the form offers the same 30");
  });
});

// ------------------------------ step 4: a Credit Note for goods back after billing (P292)

describe("a Credit Note credits what came back after the Invoice", () => {
  let srId = 0;
  let invId = 0;
  let invLine = 0;
  const acc = {} as Record<string, number>;
  const cnHeader = (over = {}) => ({ invoice_id: invId, credit_date: today, customer_return_no: "NR-1", note: "", ...over });

  before(async () => {
    const sub = async (label: string) =>
      (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
    acc.ar = await makeAccount({ subcategoryLabel: await sub("1"), partnerCategoryLabel: "Customer" });
    acc.vat = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit" });
    acc.rev = await makeAccount({ subcategoryLabel: await sub("4"), normalBalance: "Kredit" });
    acc.ret = await makeAccount({ subcategoryLabel: await sub("4") });
    for (const [k, v] of [
      ["receivable_account", acc.ar],
      ["sales_revenue_account", acc.rev],
      ["output_vat_account", acc.vat],
      ["sales_return_account", acc.ret],
    ] as const) {
      await setMapping(k, String(v));
    }
    const idr = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
    const bankAcc = await makeAccount({ subcategoryLabel: await sub("1") });
    f.bank = (
      await prisma.mCashBank.create({
        data: { cash_bank_code: `test.${key("BANK")}`, cash_bank_label: key("BANK"), cash_bank_name: "Bank Uji", cash_bank_type: "Bank", currency_id: idr, account_id: bankAcc, created_by: actor },
      })
    ).id;
    // Bill the 30 left on the note: DPP 30.000, PPN round(12 % × 27.500) = 3.300.
    const inv = await createInvoice(
      { customer_order_id: flow.coId, invoice_date: today, address_id: flow.address, cash_bank_id: f.bank, note: "" },
      [{ delivery_note_line_id: flow.dnLine }],
      [],
      actor
    );
    assert.ok(inv.ok, JSON.stringify(inv));
    ids.inv.push(inv.id);
    invId = inv.id;
    const posted = await transitionInvoice(inv.id, "post", actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    invLine = (await prisma.finArInvoiceLine.findFirstOrThrow({ where: { invoice_id: inv.id } })).id;
    // Then 5 more come back.
    const r = await create(header(), [line(5)]);
    assert.ok(r.ok, JSON.stringify(r));
    srId = r.id;
    for (const a of ["submit", "approve"] as const) await transitionSalesReturn(srId, a, actor);
    const srLine = (await prisma.salReturnLine.findFirstOrThrow({ where: { return_id: srId } })).id;
    const dnTracking = (await prisma.logDeliveryNoteTracking.findFirstOrThrow({ where: { delivery_note_line_id: flow.dnLine } })).id;
    const lots = [{ tracking_no: "", expiry_date: "", source_tracking_id: dnTracking, qty: 5, location_id: null, stock_status_id: f.available }];
    const rn = await createReceiptNote(
      { purpose: SALES_RETURN, source_doc_id: srId, rn_date: today, warehouse_id: f.warehouse, supplier_dn_no: "", note: "" },
      [{ source_doc_line_id: srLine, qty: 5, note: "", lots }],
      actor
    );
    assert.ok(rn.ok, JSON.stringify(rn));
    ids.rn.push(rn.id);
    assert.ok((await transitionReceiptNote(rn.id, "post", actor)).ok);
  });

  test("offers the Invoice with the 5 that came back after it", async () => {
    const mine = (await creditNoteOptions()).invoices.find((i) => i.id === invId);
    assert.deepEqual(mine?.lines.map((l) => [l.id, l.qty, l.returnedAfter, l.held]), [[invLine, 30, 5, 0]]);
  });

  test("refuses more than came back, and a Draft holds what it credits", async () => {
    const over = await createCreditNote(cnHeader(), [{ invoice_line_id: invLine, qty: 6 }], actor);
    assert.ok(!over.ok && /Melebihi/.test(over.errors["lines.0.qty"]));
    const a = await createCreditNote(cnHeader(), [{ invoice_line_id: invLine, qty: 2 }], actor);
    assert.ok(a.ok, JSON.stringify(a));
    ids.cn.push(a.id);
    assert.match(a.creditNo, /^CNS\/\d{4}\/\d{2}\/\d{4,}$/);
    assert.ok(!(await createCreditNote(cnHeader(), [{ invoice_line_id: invLine, qty: 4 }], actor)).ok, "the Draft holds 2 of the 5");
    const b = await createCreditNote(cnHeader(), [{ invoice_line_id: invLine, qty: 3 }], actor);
    assert.ok(b.ok, JSON.stringify(b));
    ids.cn.push(b.id);
    assert.ok((await updateCreditNote(b.id, cnHeader({ note: "x" }), [{ invoice_line_id: invLine, qty: 3 }], actor)).ok);
  });

  test("posting reverses revenue and PPN, and a Retur item lowers the Invoice item", async () => {
    const [a, b] = ids.cn;
    const preview = await creditNotePreview(a, actor);
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.ok((await transitionCreditNote(a, "post", actor)).ok);
    assert.ok((await transitionCreditNote(b, "post", actor)).ok);
    const notes = await prisma.finArCreditNote.findMany({ where: { id: { in: [a, b] } }, orderBy: { id: "asc" } });
    // 2/30, then 2..5 of 30, of 30.000 and 3.300 — each rounded once, cumulatively.
    assert.deepEqual(
      notes.map((n) => [n.dpp_amount.toNumber(), n.ppn_amount.toNumber(), n.total_amount.toNumber(), n.applied_amount.toNumber()]),
      [
        [2_000, 220, 2_220, 2_220],
        [3_000, 330, 3_330, 3_330],
      ]
    );
    const lines = await prisma.accJournalLine.findMany({ where: { journal_id: { in: notes.map((n) => n.journal_id!) } } });
    const sum = (id: number, side: "debit_amount" | "kredit_amount") => lines.filter((l) => l.account_id === id).reduce((x, l) => x + l[side].toNumber(), 0);
    assert.deepEqual([sum(acc.ret, "debit_amount"), sum(acc.vat, "debit_amount"), sum(acc.ar, "kredit_amount")], [5_000, 550, 5_550]);
    const item = await prisma.finArItem.findFirstOrThrow({ where: { item_type: "Invoice", source_doc_id: invId, partner_id: f.customer } });
    assert.equal(item.current_balance.toNumber(), 33_300 - 5_550);
    const ret = await prisma.finArItem.findMany({ where: { item_type: "Return", partner_id: f.customer }, orderBy: { id: "asc" } });
    assert.deepEqual(
      ret.map((r) => [r.original_amount.toNumber(), r.current_balance.toNumber()]),
      [
        [2_220, 0],
        [3_330, 0],
      ],
      "used up against the Invoice"
    );
    assert.equal((await creditNoteOptions()).invoices.find((i) => i.id === invId), undefined, "nothing left to credit");
    assert.ok(!(await transitionCreditNote(a, "cancel", actor, "x")).ok, "a posted Credit Note is final");
  });
});

// ------------------------------------- step 5: receipts and reports after a credit (P293)

describe("receipts and reports read an Invoice net of its Credit Notes", () => {
  const invId = () => ids.inv[0];

  test("the receipt asks for the total less what Credit Notes applied", async () => {
    const bill = (await cashReceiptOptions()).bills.find((b) => b.kind === "fin_ar_invoice" && b.id === invId())!;
    assert.deepEqual([bill.total, bill.paid, bill.open, bill.dpp, bill.ppn], [27_750, 0, 27_750, 25_000, 2_750]);
    assert.deepEqual([(await invoicePayStates([invId()]))[invId()].open], [27_750]);
  });

  test("paying what is left settles the Invoice, and no more is taken", async () => {
    const receipt = (cash: number) => ({
      purpose: "customer_receipt",
      tx_date: today,
      partner_id: f.customer,
      cash_bank_id: f.bank,
      bank_ref: "TRF",
      note: "",
      bank_charge: 0,
      lines: [{ doc_type: "fin_ar_invoice" as const, doc_id: invId(), cash, withhold: false }],
    });
    assert.ok(!(await createCashReceipt(receipt(27_751), actor)).ok, "more than is left is refused");
    const r = await createCashReceipt(receipt(27_750), actor);
    assert.ok(r.ok, JSON.stringify(r));
    ids.rc.push(r.id);
    assert.deepEqual(await transitionCashReceipt(r.id, "post", actor), { ok: true });
    const state = (await invoicePayStates([invId()]))[invId()];
    assert.deepEqual([state.state, state.open], ["Paid", 0]);
    assert.ok(!(await unpaidSalesInvoiceIds()).includes(invId()));
    const item = await prisma.finArItem.findFirstOrThrow({ where: { item_type: "Invoice", source_doc_id: invId(), partner_id: f.customer } });
    assert.equal(item.current_balance.toNumber(), 0);
  });

  test("Piutang Usaha holds the Retur items, turned round, and nets to the General Ledger", async () => {
    const book = await arBook("Invoice", { from: today, to: today }, [f.customer]);
    const [subject] = book.subjects;
    // Invoice 33.300 raised, then lowered by 5.550 credited and 27.750 paid; each Retur item lowers by its total and rises back as it is used.
    assert.deepEqual([subject.raised, subject.lowered, subject.closing], [33_300 + 5_550, 33_300 + 5_550, 0]);
    assert.equal(subject.items.length, 3, "the Invoice and its two Credit Notes");
  });

  test("Umur Piutang shows open customer credit in its own column, out of the buckets", () => {
    const row = { id: 1, partnerId: 9, partnerLabel: "C", partnerName: "C", date: today, dueDate: today, open: 1_000, sourceNo: "X", sourceTable: "fin_ar_invoice", sourceId: 1 };
    const r = foldAging([row], [], today, [{ ...row, id: 2, open: 300, sourceTable: "fin_ar_credit_note" }]);
    assert.deepEqual([r.totals.invoice, r.totals.credit, r.totals.net], [1_000, 300, 700]);
    assert.equal(r.partners[0].credits.length, 1);
  });

  test("no Retur item of this customer is left open once used up", async () => {
    assert.equal((await openArItemsAsOf("Return", today, f.customer)).length, 0);
  });
});

// ---------------------- step 7: customer credit refunded or used by the next Invoice (P295)

describe("customer credit left on a Credit Note is refunded or used by the next Invoice", () => {
  let cnId = 0;
  let retItem = 0;

  before(async () => {
    // Five more come back after the Invoice was paid: the credit has nothing to apply to.
    const r = await create(header(), [line(5)]);
    assert.ok(r.ok, JSON.stringify(r));
    for (const a of ["submit", "approve"] as const) await transitionSalesReturn(r.id, a, actor);
    const srLine = (await prisma.salReturnLine.findFirstOrThrow({ where: { return_id: r.id } })).id;
    const dnTracking = (await prisma.logDeliveryNoteTracking.findFirstOrThrow({ where: { delivery_note_line_id: flow.dnLine } })).id;
    const lots = [{ tracking_no: "", expiry_date: "", source_tracking_id: dnTracking, qty: 5, location_id: null, stock_status_id: f.available }];
    const rn = await createReceiptNote(
      { purpose: SALES_RETURN, source_doc_id: r.id, rn_date: today, warehouse_id: f.warehouse, supplier_dn_no: "", note: "" },
      [{ source_doc_line_id: srLine, qty: 5, note: "", lots }],
      actor
    );
    assert.ok(rn.ok, JSON.stringify(rn));
    ids.rn.push(rn.id);
    assert.ok((await transitionReceiptNote(rn.id, "post", actor)).ok);
    const invLine = (await prisma.finArInvoiceLine.findFirstOrThrow({ where: { invoice_id: ids.inv[0] } })).id;
    const cn = await createCreditNote({ invoice_id: ids.inv[0], credit_date: today, customer_return_no: "", note: "" }, [{ invoice_line_id: invLine, qty: 5 }], actor);
    assert.ok(cn.ok, JSON.stringify(cn));
    ids.cn.push(cn.id);
    cnId = cn.id;
    assert.ok((await transitionCreditNote(cn.id, "post", actor)).ok);
    const n = await prisma.finArCreditNote.findUniqueOrThrow({ where: { id: cn.id } });
    retItem = n.ar_item_id!;
    assert.deepEqual([n.total_amount.toNumber(), n.applied_amount.toNumber()], [5_550, 0], "the paid Invoice takes none of it");
  });

  test("Umur Piutang reads the open credit", async () => {
    const open = await openArItemsAsOf("Return", today, f.customer);
    assert.deepEqual(open.map((o) => o.open), [5_550]);
  });

  test("a refund pays part of it back: Dr Piutang Usaha / Cr Kas & Bank, no tax", async () => {
    const refund = (cash: number) => ({
      purpose: "customer_refund",
      tx_date: today,
      partner_id: f.customer,
      cash_bank_id: f.bank,
      bank_ref: "",
      note: "",
      bank_charge: 0,
      lines: [{ doc_type: "fin_ar_credit_note" as const, doc_id: cnId, cash, withhold: false }],
    });
    const offered = (await cashPaymentOptions()).bills.find((b) => b.kind === "fin_ar_credit_note" && b.id === cnId);
    assert.deepEqual([offered?.total, offered?.open], [5_550, 5_550]);
    assert.ok(!(await createCashPayment(refund(5_551), actor)).ok, "never more than the credit left");
    const p = await createCashPayment(refund(2_000), actor);
    assert.ok(p.ok, JSON.stringify(p));
    ids.rc.push(p.id);
    const posted = await transitionCashPayment(p.id, "post", actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    const t = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: p.id } });
    const jl = await prisma.accJournalLine.findMany({ where: { journal_id: t.journal_id! }, orderBy: { sequence_no: "asc" } });
    const ar = Number((await prisma.sysSetting.findUniqueOrThrow({ where: { setting_key: "receivable_account" } })).setting_value);
    assert.deepEqual(
      jl.map((l) => [l.account_id === ar, l.partner_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [true, f.customer, 2_000, 0],
        [false, null, 0, 2_000],
      ]
    );
    const item = await prisma.finArItem.findUniqueOrThrow({ where: { id: retItem } });
    assert.deepEqual([item.current_balance.toNumber(), item.paid_amount.toNumber()], [3_550, 2_000]);
  });

  test("the next Invoice of the order uses the rest, with no journal for it in rupiah", async () => {
    // Ten more leave on a new Delivery Note, billed by a new Invoice: DPP 10.000, PPN 1.100.
    const doLine = await prisma.salDeliveryOrderLine.findFirstOrThrow({ where: { delivery_order_id: ids.do[0] } });
    const dn = await createDeliveryNote(
      { source_doc_id: ids.do[0], dn_date: today, vehicle_no: "", driver_name: "", note: "" },
      [{ source_doc_line_id: doLine.id, qty: 10, note: "", picks: [{ tracking_id: f.lot, base_qty: 10 }] }],
      actor
    );
    assert.ok(dn.ok, JSON.stringify(dn));
    ids.dn.push(dn.id);
    assert.ok((await transitionDeliveryNote(dn.id, "post", actor)).ok);
    const dnLine = (await prisma.logDeliveryNoteLine.findFirstOrThrow({ where: { delivery_note_id: dn.id } })).id;
    const head = (credit: number) => ({ customer_order_id: flow.coId, invoice_date: today, address_id: flow.address, cash_bank_id: f.bank, note: "", credit_used: credit });
    const offered = (await invoiceOptions()).orders.find((o) => o.id === flow.coId)!;
    assert.deepEqual(offered.credit, { available: 3_550, reserved: 0 });
    const tooMuch = await createInvoice(head(3_551), [{ delivery_note_line_id: dnLine }], [], actor);
    assert.ok(!tooMuch.ok && /Melebihi kredit retur/.test(tooMuch.errors.credit_used));
    const inv = await createInvoice(head(3_550), [{ delivery_note_line_id: dnLine }], [], actor);
    assert.ok(inv.ok, JSON.stringify(inv));
    ids.inv.push(inv.id);
    const posted = await transitionInvoice(inv.id, "post", actor);
    assert.ok(posted.ok, JSON.stringify(posted));
    const v = await prisma.finArInvoice.findUniqueOrThrow({ where: { id: inv.id }, include: { credit_uses: true } });
    assert.deepEqual(v.credit_uses.map((u) => [u.ar_item_id, u.amount.toNumber(), u.fx_difference.toNumber()]), [[retItem, 3_550, 0]]);
    const jl = await prisma.accJournalLine.findMany({ where: { journal_id: v.journal_id! } });
    assert.equal(jl.filter((l) => (l.description ?? "").includes("Kredit retur")).length, 0, "rupiah: both sides are Piutang of one customer");
    assert.equal((await prisma.finArItem.findUniqueOrThrow({ where: { id: retItem } })).current_balance.toNumber(), 0);
    // The receipt asks for what is left: 11.100 − 3.550.
    const bill = (await cashReceiptOptions()).bills.find((b) => b.kind === "fin_ar_invoice" && b.id === inv.id)!;
    assert.deepEqual([bill.total, bill.open], [7_550, 7_550]);
  });
});
