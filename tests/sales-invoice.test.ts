import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";

import { createCustomerOrder, transitionCustomerOrder } from "../src/lib/erp/customer-order";
import { createSalesOrder, transitionSalesOrder } from "../src/lib/erp/sales-order";
import { createDeliveryOrder, transitionDeliveryOrder } from "../src/lib/erp/delivery-order";
import { createDeliveryNote, transitionDeliveryNote } from "../src/lib/erp/delivery-note";
import { createSalesAdvance, transitionSalesAdvance } from "../src/lib/erp/sales-advance";
import { cashReceiptOptions, checkCashReceipt, createCashReceipt, transitionCashReceipt } from "../src/lib/erp/cash-bank-tx";
import { setItemCost } from "../src/lib/erp/inventory";
import {
  checkInvoice,
  createInvoice,
  invoicePayStates,
  settlementInvoices,
  deliveryNoteBilling,
  getInvoice,
  invoiceOptions,
  invoicePreview,
  transitionInvoice,
  updateInvoice,
  type InvoiceDeductionInput,
  type InvoiceHeaderInput,
} from "../src/lib/erp/sales-invoice";
import { cashToClear, computeInvoice, invoiceLineAmount, settleBillFromCash } from "../src/lib/erp/sales-tax";
import { availableInvoiceActions, invoiceAbilities } from "../src/lib/erp/sales-invoice-workflow";
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
 * The Faktur Penjualan (`Sales-Process-Concept.md` §9, U16–U22): one Customer
 * Order, whole lines of its posted Delivery Notes, the order's price mode and
 * PPN snapshot, the Uang Muka the user picks. Its own date; the tax date and
 * due date from the latest Tanggal Kirim. Posting: Dr Piutang (net) · Dr Uang
 * Muka (DPP used) / Cr Penjualan (full DPP) · Cr PPN Keluaran (on the net
 * DPP), the Invoice AR item, and *Dipakai Invoice* on each Uang Muka used.
 * And the Customer Order closes itself once fully delivered (U21).
 *
 * The order: line A 10 PCS × 100.000 less a nominal 10.000 (PPh 1,5 %), line B
 * 4 PCS × 50.000; Exclude, Kena PPN 12 % × 11/12. An advance bill of Nominal
 * 300.000 (DPP), paid in full: one Uang Muka item of DPP 300.000.
 */

const today = new Date().toISOString().slice(0, 10);
let actor = 0;
const f = {} as Record<string, number>;
const ids = { co: [] as number[], so: [] as number[], do: [] as number[], dn: [] as number[], adv: [] as number[], rc: [] as number[], inv: [] as number[] };
const savedSettings = new Map<string, string | null>();
const cleanups: (() => Promise<unknown>)[] = [];
const stamp = String(Date.now() % 100000);
const key = (s: string) => `${FIXTURE_PREFIX}${s}${stamp}`;

async function setMapping(k: string, v: string | null) {
  if (!savedSettings.has(k)) {
    savedSettings.set(k, (await prisma.sysSetting.findUnique({ where: { setting_key: k } }))?.setting_value ?? null);
  }
  await prisma.sysSetting.upsert({ where: { setting_key: k }, update: { setting_value: v }, create: { setting_key: k, setting_value: v, updated_by: actor } });
}

const order = { co: 0, address: 0, coLines: [] as number[], doLines: [] as number[] };
const notes = { first: 0, second: 0, firstLines: [] as number[], secondLines: [] as number[] };
let advanceItem = 0;

const header = (over: Partial<InvoiceHeaderInput> = {}): InvoiceHeaderInput => ({
  customer_order_id: order.co,
  invoice_date: today,
  address_id: order.address,
  cash_bank_id: f.bank,
  note: "",
  ...over,
});
const lines = (lineIds: number[]) => lineIds.map((id) => ({ delivery_note_line_id: id }));
const use = (dpp: number | string, item = advanceItem): InvoiceDeductionInput[] => [{ ar_item_id: item, dpp_used: dpp }];

async function create(h: InvoiceHeaderInput, l: number[], d: InvoiceDeductionInput[] = []) {
  const r = await createInvoice(h, lines(l), d, actor);
  if (r.ok) ids.inv.push(r.id);
  return r;
}

async function postedNote(doLineQty: [number, number][]) {
  const r = await createDeliveryNote(
    { delivery_order_id: f.do, dn_date: today, vehicle_no: "", driver_name: "", note: "" },
    doLineQty.map(([id, qty]) => ({ delivery_order_line_id: id, qty, note: "" })),
    actor
  );
  assert.ok(r.ok, JSON.stringify(r));
  ids.dn.push(r.id);
  const p = await transitionDeliveryNote(r.id, "post", actor);
  assert.ok(p.ok, JSON.stringify(p));
  const dnLines = await prisma.salDeliveryNoteLine.findMany({ where: { delivery_note_id: r.id }, orderBy: { line_no: "asc" } });
  return { id: r.id, lines: dnLines.map((l) => l.id) };
}

before(async () => {
  actor = await systemUserId();
  await openFiscalYear();
  f.pcs = (await prisma.refUom.create({ data: { uom_code: `test.${key("PCS")}`, uom_label: key("PCS"), uom_name: "Pcs", created_by: actor } })).id;
  const cat = (await prisma.sysItemCategory.findUniqueOrThrow({ where: { category_label: "BRG-JADI" } })).id;
  const item = async (l: string) =>
    (await prisma.mItem.create({ data: { item_code: `test.${key(l)}`, item_label: key(l), item_name: l, item_type: "Barang", category_id: cat, base_uom_id: f.pcs, can_sell: true, created_by: actor } })).id;
  f.a = await item("A");
  f.b = await item("B");
  f.term = (await prisma.refPaymentTerm.create({ data: { term_code: `test.${key("T")}`, term_label: key("T"), term_name: "Net 30", due_days: 30, created_by: actor } })).id;
  f.warehouse = (await prisma.refWarehouse.create({ data: { warehouse_code: `test.${key("WH")}`, warehouse_label: key("WH"), warehouse_name: "Gudang Uji", created_by: actor } })).id;

  const sub = async (label: string) =>
    (await prisma.accAccountSubcategory.findFirstOrThrow({ where: { subcategory_label: { startsWith: label } }, orderBy: { id: "asc" } })).subcategory_label;
  f.pphAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.arAcc = await makeAccount({ subcategoryLabel: await sub("1"), partnerCategoryLabel: "Customer" });
  f.advAcc = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit", partnerCategoryLabel: "Customer" });
  f.vatAcc = await makeAccount({ subcategoryLabel: await sub("2"), normalBalance: "Kredit" });
  f.revAcc = await makeAccount({ subcategoryLabel: await sub("4"), normalBalance: "Kredit" });
  f.cogsAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  f.invAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  f.feeAcc = await makeAccount({ subcategoryLabel: await sub("5") });
  f.wht = (await prisma.refWithholdingTax.create({ data: { wht_code: `test.${key("WHT")}`, wht_label: key("WHT"), wht_name: "PPh Uji", rate: 1.5, prepaid_account_id: f.pphAcc, created_by: actor } })).id;
  for (const [k, v] of [
    ["receivable_account", f.arAcc],
    ["sales_revenue_account", f.revAcc],
    ["sales_advance_account", f.advAcc],
    ["output_vat_account", f.vatAcc],
    ["bank_charge_account", f.feeAcc],
    ["cogs_account", f.cogsAcc],
    ["inventory_account", f.invAcc],
  ] as const) {
    await setMapping(k, String(v));
  }
  const bankAcc = await makeAccount({ subcategoryLabel: await sub("1") });
  const idr = (await prisma.refCurrency.findFirstOrThrow({ where: { currency_label: "IDR" } })).id;
  f.bank = (
    await prisma.mCashBank.create({
      data: { cash_bank_code: `test.${key("BANK")}`, cash_bank_label: key("BANK"), cash_bank_name: "Bank Uji", cash_bank_type: "Bank", currency_id: idr, account_id: bankAcc, created_by: actor },
    })
  ).id;

  // The customer and the order: Open, taxable, Exclude.
  f.customer = await makePartner({ categoryLabel: "Customer" });
  await prisma.mPartner.update({
    where: { id: f.customer },
    data: { taxpayer_type: "Badan", tax_id_type: "NPWP", tax_id: "0987654321098765", tax_name: "PT FIXTURE", is_pkp: true },
  });
  const village = await prisma.sysRegionVillage.findFirstOrThrow({ orderBy: { code: "asc" } });
  order.address = (await prisma.mPartnerAddress.create({ data: { partner_id: f.customer, village_id: village.id, street: "Kantor", created_by: actor } })).id;
  f.billing = (await prisma.mPartnerAddress.create({ data: { partner_id: f.customer, village_id: village.id, street: "Keuangan", is_billing: true, created_by: actor } })).id;
  const co = await createCustomerOrder(
    { order_date: today, customer_id: f.customer, address_id: order.address, term_id: f.term, price_mode: "Exclude", is_taxable: true, po_no: "", po_date: "", salesperson: "", note: "" },
    [
      { item_id: f.a, uom_id: f.pcs, qty: 10, price: 100_000, discount_type: "Amount", discount_value: 10_000, withholding_tax_id: f.wht, note: "" },
      { item_id: f.b, uom_id: f.pcs, qty: 4, price: 50_000, discount_type: null, discount_value: null, withholding_tax_id: null, note: "" },
    ],
    actor
  );
  assert.ok(co.ok, JSON.stringify(co));
  order.co = co.id;
  ids.co.push(co.id);
  await transitionCustomerOrder(co.id, "submit", actor);
  await transitionCustomerOrder(co.id, "approve", actor);
  order.coLines = (await prisma.salCustomerOrderLine.findMany({ where: { order_id: co.id }, orderBy: { line_no: "asc" } })).map((l) => l.id);

  const so = await createSalesOrder(
    { customer_order_id: co.id, order_date: today, delivery_date: today, address_id: order.address, note: "" },
    [{ customer_order_line_id: order.coLines[0], qty: 10, note: "" }, { customer_order_line_id: order.coLines[1], qty: 4, note: "" }],
    actor
  );
  assert.ok(so.ok, JSON.stringify(so));
  ids.so.push(so.id);
  for (const a of ["submit", "approve", "confirm"] as const) await transitionSalesOrder(so.id, a, actor);
  const soLines = await prisma.salOrderLine.findMany({ where: { order_id: so.id }, orderBy: { line_no: "asc" } });
  const dOrder = await createDeliveryOrder(
    { customer_order_id: co.id, do_date: today, delivery_date: today, warehouse_id: f.warehouse, address_id: order.address, note: "" },
    soLines.map((l) => ({ sales_order_line_id: l.id, qty: l.qty.toNumber(), note: "" })),
    actor
  );
  assert.ok(dOrder.ok, JSON.stringify(dOrder));
  f.do = dOrder.id;
  ids.do.push(dOrder.id);
  await transitionDeliveryOrder(dOrder.id, "issue", actor);
  order.doLines = (await prisma.salDeliveryOrderLine.findMany({ where: { delivery_order_id: dOrder.id }, orderBy: { line_no: "asc" } })).map((l) => l.id);

  // The advance: Nominal 300.000 DPP, paid in full without PPh.
  const adv = await createSalesAdvance(
    { order_id: co.id, advance_date: today, due_date: today, cash_bank_id: f.bank, description: "UM", note: "", amount_type: "Amount", amount_value: 300_000 },
    actor
  );
  assert.ok(adv.ok, JSON.stringify(adv));
  ids.adv.push(adv.id);
  await transitionSalesAdvance(adv.id, "issue", actor);
  const rc = await createCashReceipt(
    { purpose: "customer_receipt", tx_date: today, partner_id: f.customer, cash_bank_id: f.bank, bank_ref: "", note: "", bank_charge: 0, lines: [{ doc_id: adv.id, cash: 333_000, withhold: false }] },
    actor
  );
  assert.ok(rc.ok, JSON.stringify(rc));
  ids.rc.push(rc.id);
  assert.deepEqual(await transitionCashReceipt(rc.id, "post", actor), { ok: true });
  advanceItem = (await prisma.finArItem.findFirstOrThrow({ where: { customer_order_id: co.id, item_type: "Advance" } })).id;
  // A second bill, issued and left unpaid, for the mixed receipt (§7.8).
  const adv2 = await createSalesAdvance(
    { order_id: co.id, advance_date: today, due_date: today, cash_bank_id: f.bank, description: "UM 2", note: "", amount_type: "Amount", amount_value: 100_000 },
    actor
  );
  assert.ok(adv2.ok, JSON.stringify(adv2));
  ids.adv.push(adv2.id);
  f.bill2 = adv2.id;
  await transitionSalesAdvance(adv2.id, "issue", actor);

  await setItemCost(f.a, "40000", actor);
  await setItemCost(f.b, "20000", actor);
  const first = await postedNote([[order.doLines[0], 4], [order.doLines[1], 4]]);
  notes.first = first.id;
  notes.firstLines = first.lines;

  cleanups.push(
    () => prisma.tmpStockMovement.deleteMany({ where: { item_id: { in: [f.a, f.b] } } }),
    () => prisma.tmpItemCost.deleteMany({ where: { item_id: { in: [f.a, f.b] } } }),
    () => prisma.mItem.deleteMany({ where: { id: { in: [f.a, f.b] } } }),
    () => prisma.refUom.deleteMany({ where: { id: f.pcs } }),
    () => prisma.refPaymentTerm.deleteMany({ where: { id: f.term } }),
    () => prisma.refWarehouse.deleteMany({ where: { id: f.warehouse } }),
    () => prisma.refWithholdingTax.deleteMany({ where: { id: f.wht } })
  );
});

after(async () => {
  await prisma.salInvoiceLine.deleteMany({ where: { invoice_id: { in: ids.inv } } });
  await prisma.salInvoiceAdvanceDeduction.deleteMany({ where: { invoice_id: { in: ids.inv } } });
  await prisma.salInvoice.deleteMany({ where: { id: { in: ids.inv } } });
  const items = await prisma.finArItem.findMany({ where: { customer_order_id: { in: ids.co } }, select: { id: true } });
  await prisma.finArLedger.deleteMany({ where: { OR: [{ item_id: { in: items.map((i) => i.id) } }, { counter_item_id: { in: items.map((i) => i.id) } }] } });
  await prisma.finArItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
  await prisma.finCashBankTx.deleteMany({ where: { id: { in: ids.rc } } });
  await prisma.salAdvance.deleteMany({ where: { id: { in: ids.adv } } });
  await prisma.salDeliveryNotePick.deleteMany({ where: { line: { delivery_note_id: { in: ids.dn } } } });
  await prisma.salDeliveryNoteLine.deleteMany({ where: { delivery_note_id: { in: ids.dn } } });
  await prisma.salDeliveryNote.deleteMany({ where: { id: { in: ids.dn } } });
  await prisma.salDeliveryOrderLine.deleteMany({ where: { delivery_order_id: { in: ids.do } } });
  await prisma.salDeliveryOrder.deleteMany({ where: { id: { in: ids.do } } });
  await prisma.salOrderLine.deleteMany({ where: { order_id: { in: ids.so } } });
  await prisma.salOrder.deleteMany({ where: { id: { in: ids.so } } });
  await prisma.salCustomerOrderLine.deleteMany({ where: { order_id: { in: ids.co } } });
  await prisma.salCustomerOrder.deleteMany({ where: { id: { in: ids.co } } });
  for (const [k, list] of Object.entries({
    sal_invoice: ids.inv,
    fin_cash_bank_tx: ids.rc,
    sal_advance: ids.adv,
    sal_delivery_note: ids.dn,
    sal_delivery_order: ids.do,
    sal_order: ids.so,
    sal_customer_order: ids.co,
  })) {
    await prisma.auditLog.deleteMany({ where: { entity_key: k, row_id: { in: list } } });
  }
  const costIds = (await prisma.tmpItemCost.findMany({ where: { item_id: { in: [f.a, f.b] } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { entity_key: "tmp_item_cost", row_id: { in: costIds } } });
  for (const [k, v] of savedSettings) await prisma.sysSetting.update({ where: { setting_key: k }, data: { setting_value: v } });
  if (f.wht) await prisma.refWithholdingTax.update({ where: { id: f.wht }, data: { prepaid_account_id: null } });
  await cleanupFixtures();
  for (const c of cleanups) await c();
  await cleanupFiscalYear();
  await disconnect();
});

// -------------------------------------------------------------- arithmetic

describe("a Faktur line's amount (§9.3)", () => {
  const base = { orderQty: 10, orderAmount: 990_000, price: 100_000, discountType: "Amount" as const, discountValue: 10_000, withholdingRate: null, withholdingKey: null };
  test("a nominal discount is shared by quantity; the completing bill takes what is left", () => {
    assert.equal(invoiceLineAmount({ ...base, qty: 4, billedQtyBefore: 0, billedAmountBefore: 0 }), 396_000);
    assert.equal(invoiceLineAmount({ ...base, qty: 3, billedQtyBefore: 4, billedAmountBefore: 396_000 }), 297_000);
    assert.equal(invoiceLineAmount({ ...base, qty: 3, billedQtyBefore: 7, billedAmountBefore: 693_000 }), 297_000, "990.000 − 693.000");
  });

  test("the advance is shared over the lines; PPN is the chain on each line's net DPP", () => {
    const f = computeInvoice({
      lines: [
        { ...base, qty: 4, billedQtyBefore: 0, billedAmountBefore: 0, withholdingRate: 1.5, withholdingKey: "w" },
        { orderQty: 4, orderAmount: 200_000, price: 50_000, discountType: null, discountValue: null, qty: 4, billedQtyBefore: 0, billedAmountBefore: 0, withholdingRate: null, withholdingKey: null },
      ],
      mode: "Exclude",
      taxable: true,
      rates: { rate: 12, otherNum: 11, otherDen: 12 },
      advanceUsed: 100_000,
    });
    assert.deepEqual(f.lines.map((l) => [l.dpp, l.advanceDpp, l.netDpp, l.dppOther, l.ppn]), [
      [396_000, 66_443, 329_557, 302_094, 36_251],
      [200_000, 33_557, 166_443, 152_573, 18_309],
    ]);
    assert.deepEqual([f.dpp, f.advanceUsed, f.netDpp, f.ppn, f.total], [596_000, 100_000, 496_000, 54_560, 550_560]);
    assert.deepEqual(f.withholdings.map((w) => [w.base, w.amount]), [[329_557, 4_943]]);
  });
});

// ----------------------------------------------------------------- options

describe("what a Faktur may bill (U16, U17)", () => {
  test("the order is offered with its posted lines and its open Uang Muka", async () => {
    const o = (await invoiceOptions()).orders.find((x) => x.id === order.co)!;
    assert.ok(o, "an order with posted, unbilled lines is offered");
    assert.deepEqual(o.noteLines.map((l) => [l.id, l.qty, l.billedBy]), [
      [notes.firstLines[0], 4, null],
      [notes.firstLines[1], 4, null],
    ]);
    assert.deepEqual(o.advances.map((a) => [a.id, a.balance, a.taxDpp]), [[advanceItem, 300_000, 300_000]]);
    assert.ok(o.addresses.some((a) => a.id === f.billing && a.isBilling));
    assert.equal(o.mode, "Exclude");
  });

  test("no line, another order's line, a date before the latest Tanggal Kirim, or more Uang Muka than is left is refused", async () => {
    const none = await checkInvoice(prisma, header(), [], [], null);
    assert.ok(!none.ok && none.errors._lines);
    const wrong = await checkInvoice(prisma, header(), lines([999_999_999]), [], null);
    assert.ok(!wrong.ok && /bukan bagian/.test(wrong.errors["lines.0.delivery_note_line_id"]));
    const early = await checkInvoice(prisma, header({ invoice_date: "2020-01-01" }), lines(notes.firstLines), [], null);
    assert.ok(!early.ok && /Tanggal Kirim terakhir/.test(early.errors.invoice_date));
    const over = await checkInvoice(prisma, header(), lines(notes.firstLines), use(300_001), null);
    assert.ok(!over.ok && /Melebihi sisa uang muka/.test(over.errors["deductions.0.dpp_used"]));
    const tooMuch = await checkInvoice(prisma, header(), lines([notes.firstLines[1]]), use(200_001), null);
    assert.ok(!tooMuch.ok && /melebihi DPP faktur/.test(tooMuch.errors._deductions));
  });
});

// ---------------------------------------------------------------- the Draft

describe("a Draft holds its lines and reserves its Uang Muka", () => {
  test("saved: numbered INV/…, taxed and due from the latest Tanggal Kirim, no journal", async () => {
    const journals = await prisma.accJournal.count();
    const r = await create(header({ address_id: f.billing }), notes.firstLines, use(100_000));
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.invoiceNo, /^INV\/\d{4}\/\d{2}\/\d{4}$/);
    assert.equal(await prisma.accJournal.count(), journals);
    const v = (await getInvoice(r.id))!;
    assert.equal(v.taxDate, today);
    const due = new Date(`${today}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 30);
    assert.equal(v.dueDate, due.toISOString().slice(0, 10));
    assert.deepEqual([v.stored.dpp, v.stored.advanceUsed, v.stored.netDpp, v.stored.ppn, v.stored.total], [596_000, 100_000, 496_000, 54_560, 550_560]);
  });

  test("another Faktur cannot bill the same lines, nor take what the Draft reserves", async () => {
    const twice = await create(header(), notes.firstLines);
    assert.ok(!twice.ok && /Sudah ditagih dengan INV\//.test(twice.errors["lines.0.delivery_note_line_id"]));
    const o = (await invoiceOptions()).orders.find((x) => x.id === order.co);
    assert.ok(!o, "nothing left to bill");
    assert.deepEqual(await deliveryNoteBilling(notes.firstLines), {
      [notes.firstLines[0]]: { id: ids.inv[0], no: (await getInvoice(ids.inv[0]))!.invoiceNo, status: "Draft" },
      [notes.firstLines[1]]: { id: ids.inv[0], no: (await getInvoice(ids.inv[0]))!.invoiceNo, status: "Draft" },
    });
  });

  test("editing a Draft does not count against itself", async () => {
    const r = await updateInvoice(ids.inv[0], header({ address_id: f.billing, note: "ubah" }), lines(notes.firstLines), use(100_000), actor);
    assert.ok(r.ok, JSON.stringify(r));
  });
});

// ----------------------------------------------------------------- posting

describe("Posting recognises Piutang, revenue and PPN once", () => {
  test("refused while Account Mapping lacks Piutang Usaha, and the preview says so", async () => {
    await setMapping("receivable_account", null);
    const preview = (await invoicePreview(ids.inv[0]))!;
    const refused = await transitionInvoice(ids.inv[0], "post", actor);
    await setMapping("receivable_account", String(f.arAcc));
    assert.ok(preview.blocked.some((b) => /Account Mapping/.test(b)));
    assert.ok(!refused.ok && /Account Mapping/.test(refused.errors._form));
  });

  test("Dr Piutang 550.560 · Dr Uang Muka 100.000 / Cr Penjualan 596.000 · Cr PPN 54.560", async () => {
    const preview = (await invoicePreview(ids.inv[0]))!;
    assert.deepEqual(preview.blocked, []);
    const r = await transitionInvoice(ids.inv[0], "post", actor);
    assert.ok(r.ok, JSON.stringify(r));
    const v = (await getInvoice(ids.inv[0]))!;
    assert.equal(v.status, "Posted");
    const jl = await prisma.accJournalLine.findMany({ where: { journal_id: v.journalId! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(
      jl.map((l) => [l.account_id, l.partner_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [f.arAcc, f.customer, 550_560, 0],
        [f.advAcc, f.customer, 100_000, 0],
        [f.revAcc, null, 0, 596_000],
        [f.vatAcc, null, 0, 54_560],
      ]
    );
    assert.deepEqual(preview.lines.map((l) => [l.debit, l.credit]), jl.map((l) => [l.debit_amount.toNumber(), l.kredit_amount.toNumber()]));
  });

  test("the Invoice item at net Piutang, due from the Termin; the Uang Muka item used, naming it", async () => {
    const v = (await getInvoice(ids.inv[0]))!;
    const inv = await prisma.finArItem.findUniqueOrThrow({ where: { id: v.arItemId! }, include: { entries: true } });
    assert.deepEqual([inv.item_type, inv.current_balance.toNumber(), inv.source_no, inv.customer_order_id], ["Invoice", 550_560, v.invoiceNo, order.co]);
    assert.equal(inv.due_date?.toISOString().slice(0, 10), v.dueDate);
    const adv = await prisma.finArItem.findUniqueOrThrow({ where: { id: advanceItem }, include: { entries: { orderBy: { id: "asc" } } } });
    assert.equal(adv.current_balance.toNumber(), 200_000);
    assert.deepEqual(adv.entries.map((e) => [e.event, e.movement.toNumber(), e.counter_item_id]), [
      ["Create", 300_000, null],
      ["AdvanceUsed", -100_000, inv.id],
    ]);
  });

  test("a posted Faktur is final", async () => {
    assert.ok(!(await updateInvoice(ids.inv[0], header(), lines(notes.firstLines), [], actor)).ok);
    assert.ok(!(await transitionInvoice(ids.inv[0], "cancel", actor, "x")).ok);
    assert.deepEqual(availableInvoiceActions("Posted", invoiceAbilities(["SALES_INVOICE_POST", "SALES_INVOICE_CANCEL"])), []);
  });
});

// ------------------------------------------------- the rest of the order

describe("the order is finished when its delivery is; billing comes after (U21)", () => {
  test("the note that sends the rest closes the Customer Order", async () => {
    const second = await postedNote([[order.doLines[0], 6]]);
    notes.second = second.id;
    notes.secondLines = second.lines;
    const co = await prisma.salCustomerOrder.findUniqueOrThrow({ where: { id: order.co } });
    assert.deepEqual([co.status, co.status_reason], ["Closed", null]);
    const lines = await prisma.salCustomerOrderLine.findMany({ where: { order_id: order.co }, orderBy: { line_no: "asc" } });
    assert.deepEqual(lines.map((l) => l.delivered_qty.toNumber()), [10, 4]);
    const event = await prisma.auditLog.findFirst({ where: { entity_key: "sal_customer_order", row_id: order.co, event: "fulfil" } });
    assert.ok(event);
  });

  test("a cancelled Draft frees its lines and its Uang Muka", async () => {
    const draft = await create(header(), notes.secondLines, use(200_000));
    assert.ok(draft.ok, JSON.stringify(draft));
    assert.deepEqual(await transitionInvoice(draft.id, "cancel", actor), { ok: false, errors: { reason: "Alasan wajib diisi." } });
    assert.deepEqual(await transitionInvoice(draft.id, "cancel", actor, "salah pilih"), { ok: true });
    assert.deepEqual(await deliveryNoteBilling(notes.secondLines), {});
    const o = (await invoiceOptions()).orders.find((x) => x.id === order.co)!;
    assert.deepEqual(o.advances.map((a) => [a.balance, a.reserved]), [[200_000, 0]]);
  });

  test("a closed order is still billed for what it sent; the completing bill takes the remainder", async () => {
    const r = await create(header(), notes.secondLines, use(200_000));
    assert.ok(r.ok, JSON.stringify(r));
    const v = (await getInvoice(r.id))!;
    // 990.000 − 396.000 billed before.
    assert.deepEqual([v.stored.amount, v.stored.dpp, v.stored.advanceUsed, v.stored.netDpp], [594_000, 594_000, 200_000, 394_000]);
    assert.ok((await transitionInvoice(r.id, "post", actor)).ok);
    const adv = await prisma.finArItem.findUniqueOrThrow({ where: { id: advanceItem } });
    assert.equal(adv.current_balance.toNumber(), 0, "the advance is used up");
    assert.equal((await deliveryNoteBilling(notes.secondLines))[notes.secondLines[0]].status, "Posted");
  });
});

// -------------------------------------------- paying it (§7.8, U23–U28)

describe("Penerimaan dari Customer pays Fakturs and advance bills together", () => {
  const receipt = (lines: { doc_type: "sal_advance" | "sal_invoice"; doc_id: number; cash: number; withhold: boolean }[]) => ({
    purpose: "customer_receipt",
    tx_date: today,
    partner_id: f.customer,
    cash_bank_id: f.bank,
    bank_ref: "TRF",
    note: "",
    bank_charge: 0,
    lines,
  });
  const inv = () => ({ first: ids.inv[0], second: ids.inv[ids.inv.length - 1] });

  test("the form offers the customer's posted Fakturs beside its issued bills, each open by its Invoice item", async () => {
    const o = await cashReceiptOptions();
    const mine = o.bills.filter((b) => b.customerId === f.customer);
    assert.ok(mine.some((b) => b.kind === "sal_advance" && b.id === f.bill2));
    const first = mine.find((b) => b.kind === "sal_invoice" && b.id === inv().first)!;
    assert.deepEqual([first.total, first.paid, first.open], [550_560, 0, 550_560]);
    // PPh on the net DPP, after the Uang Muka (U24): 1,5 % × 329.557.
    assert.deepEqual(first.withholdings.map((w) => [w.base, w.amount]), [[329_557, 4_943]]);
    assert.deepEqual(o.purposes.map((p) => p.key), ["customer_receipt"]);
  });

  test("a part payment clears Piutang by cash + its PPh share, and records Pembayaran on the Invoice item", async () => {
    const [bill] = await settlementInvoices({ ids: [inv().first] });
    const expected = settleBillFromCash({ bill, before: 0, cash: 300_000, withhold: true });
    const r = await createCashReceipt(receipt([{ doc_type: "sal_invoice", doc_id: inv().first, cash: 300_000, withhold: true }]), actor);
    assert.ok(r.ok, JSON.stringify(r));
    ids.rc.push(r.id);
    assert.deepEqual(await transitionCashReceipt(r.id, "post", actor), { ok: true });
    const t = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: r.id } });
    const jl = await prisma.accJournalLine.findMany({ where: { journal_id: t.journal_id! }, orderBy: { sequence_no: "asc" } });
    assert.deepEqual(
      jl.map((l) => [l.account_id, l.partner_id, l.debit_amount.toNumber(), l.kredit_amount.toNumber()]),
      [
        [jl[0].account_id, null, 300_000, 0],
        [f.pphAcc, null, expected.pph, 0],
        [f.arAcc, f.customer, 0, expected.settled],
      ]
    );
    const item = await prisma.finArItem.findUniqueOrThrow({ where: { id: bill.arItemId! }, include: { entries: { orderBy: { id: "asc" } } } });
    assert.deepEqual(item.entries.map((e) => [e.event, e.movement.toNumber(), e.doc_no]), [
      ["Create", 550_560, (await getInvoice(inv().first))!.invoiceNo],
      ["Payment", -expected.settled, t.tx_no],
    ]);
    assert.equal(await prisma.finArItem.count({ where: { entries: { some: { event: "Create", doc_id: r.id, doc_type: { doc_table: "fin_cash_bank_tx" } } } } }), 0, "no AR item is created by paying a Faktur");
    const state = (await invoicePayStates([inv().first]))[inv().first];
    assert.deepEqual([state.state, state.open], ["Partial", 550_560 - expected.settled]);
  });

  test("one transfer clears both Fakturs and an advance bill, each posting by its kind", async () => {
    const [a, b] = await settlementInvoices({ ids: [inv().first, inv().second] });
    const open = async (id: number) => (await prisma.finArItem.findUniqueOrThrow({ where: { id } })).current_balance.toNumber();
    const before = a.total - (await open(a.arItemId!));
    const clearA = cashToClear(a, before, true);
    const clearB = cashToClear(b, 0, true);
    const r = await createCashReceipt(
      receipt([
        { doc_type: "sal_invoice", doc_id: a.id, cash: clearA, withhold: true },
        { doc_type: "sal_invoice", doc_id: b.id, cash: clearB, withhold: true },
        { doc_type: "sal_advance", doc_id: f.bill2, cash: 111_000, withhold: false },
      ]),
      actor
    );
    assert.ok(r.ok, JSON.stringify(r));
    ids.rc.push(r.id);
    assert.deepEqual(await transitionCashReceipt(r.id, "post", actor), { ok: true });
    assert.deepEqual([await open(a.arItemId!), await open(b.arItemId!)], [0, 0]);
    const states = await invoicePayStates([a.id, b.id]);
    assert.deepEqual([states[a.id].state, states[b.id].state], ["Paid", "Paid"]);
    const t = await prisma.finCashBankTx.findUniqueOrThrow({ where: { id: r.id } });
    const jl = await prisma.accJournalLine.findMany({ where: { journal_id: t.journal_id! }, orderBy: { sequence_no: "asc" } });
    const credit = (acc: number) => jl.filter((l) => l.account_id === acc).reduce((s, l) => s + l.kredit_amount.toNumber(), 0);
    assert.equal(credit(f.arAcc), (a.total - before) + b.total, "Piutang cleared by all each Faktur still owed");
    assert.deepEqual([credit(f.advAcc), credit(f.vatAcc)], [100_000, 11_000], "the bill posts as an advance");
    const debit = jl.reduce((s, l) => s + l.debit_amount.toNumber(), 0);
    assert.equal(debit, jl.reduce((s, l) => s + l.kredit_amount.toNumber(), 0));
    const newAdvance = await prisma.finArItem.findFirst({ where: { item_type: "Advance", source_doc_id: f.bill2 } });
    assert.equal(newAdvance?.current_balance.toNumber(), 100_000);
  });

  test("a Faktur paid in full is offered no more, and takes no overpayment", async () => {
    const o = await cashReceiptOptions();
    assert.ok(!o.bills.some((b) => b.kind === "sal_invoice" && b.customerId === f.customer));
    const over = await checkCashReceipt(prisma, receipt([{ doc_type: "sal_invoice", doc_id: inv().first, cash: 1, withhold: true }]), null);
    assert.ok(!over.ok && /Melebihi/.test(over.errors["lines.0.cash"]));
  });
});

